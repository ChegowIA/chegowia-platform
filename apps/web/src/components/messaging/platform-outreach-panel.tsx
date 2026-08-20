"use client";

import { useState } from "react";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardActions, CardContent } from "@/components/ui/card";
import { FormField, Input, Textarea } from "@/components/ui/input";

/**
 * Prospecção ativa pelo número institucional.
 *
 * A tela é deliberadamente explícita sobre duas coisas que o WhatsApp impõe e
 * que, escondidas, fariam o disparo parecer quebrado: a primeira mensagem para
 * quem nunca escreveu tem de ser um modelo aprovado pela Meta, e o número que
 * dispara é o mesmo que atende o suporte — se ele for restringido por denúncia,
 * cai tudo junto.
 */

type ModeloDoCanal = {
  id: string | null;
  name: string | null;
  language: string | null;
  body: string | null;
  params: string[];
  configured: boolean;
};

type Campanha = {
  id: string;
  name: string;
  status: "RASCUNHO" | "ENVIANDO" | "PAUSADA" | "CONCLUIDA" | "CANCELADA";
  totalTargets: number;
  sentCount: number;
  repliedCount: number;
  failedCount: number;
  pendingCount: number;
  dailyLimit: number;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  respectBusinessHours: boolean;
  nextSendAt: string | null;
  pausedReason: string | null;
  createdByName: string | null;
  createdAt: string;
};

type Bloqueio = {
  id: string;
  phone: string;
  phoneFormatted: string;
  reason: string | null;
  blockedByName: string | null;
  createdAt: string;
};

type Conferencia = {
  total: number;
  aptos: number;
  repetidosNaLista: number;
  recusados: { texto: string; motivo: string }[];
  possiveisFixos: string[];
  descartados: { phone: string; motivo: string }[];
};

const VARIAVEIS = ["nome", "empresa", "cidade"] as const;

const STATUS_ROTULO: Record<Campanha["status"], string> = {
  RASCUNHO: "Rascunho",
  ENVIANDO: "Enviando",
  PAUSADA: "Pausado",
  CONCLUIDA: "Concluído",
  CANCELADA: "Cancelado",
};

const STATUS_COR: Record<Campanha["status"], string> = {
  RASCUNHO: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  ENVIANDO: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  PAUSADA: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  CONCLUIDA: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  CANCELADA: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
};

/**
 * Texto sugerido para submeter à aprovação.
 *
 * Modelo de marketing reprovado é a causa mais comum de disparo que não sai, e
 * o que faz a Meta reprovar é promessa exagerada, urgência falsa e mensagem que
 * não deixa claro quem está falando. Estes dois são curtos, se identificam e
 * fazem uma pergunta — o formato que passa.
 */
const MODELOS_SUGERIDOS = [
  {
    titulo: "Abertura curta",
    corpo: "Oi {{1}}, aqui é a ChegowIA. A gente faz o sistema de pedidos, cardápio e entrega de restaurantes e comércios locais. Posso te explicar em duas linhas como funciona?",
  },
  {
    titulo: "Abertura com cidade",
    corpo: "Oi {{1}}, tudo bem? Aqui é da ChegowIA, sistema de pedidos e entrega para negócios locais em {{2}}. Você é a pessoa que cuida disso aí?",
  },
];

export function PlatformOutreachPanel() {
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const { data: canal } = useQuery({
    queryKey: ["platform-whatsapp-channel"],
    queryFn: async () => (await api.get("/platform/whatsapp/channel")).data as { outreachTemplate: ModeloDoCanal; connected: boolean },
  });
  const { data: campanhas = [], isLoading: carregandoCampanhas } = useQuery({
    queryKey: ["platform-outreach-campaigns"],
    queryFn: async () => (await api.get("/platform/whatsapp/outreach/campaigns")).data as Campanha[],
    refetchInterval: 15_000,
  });
  const { data: bloqueios = [] } = useQuery({
    queryKey: ["platform-outreach-blocks"],
    queryFn: async () => (await api.get("/platform/whatsapp/outreach/blocks")).data as Bloqueio[],
  });

  const modelo = canal?.outreachTemplate;
  const [formModelo, setFormModelo] = useState<{ id: string; name: string; language: string; body: string; params: string[] } | null>(null);
  const modeloAtual = formModelo ?? {
    id: modelo?.id ?? "",
    name: modelo?.name ?? "",
    language: modelo?.language ?? "pt_BR",
    body: modelo?.body ?? "",
    params: modelo?.params ?? [],
  };

  const salvarModelo = useMutation({
    mutationFn: async () => (await api.patch("/platform/whatsapp/outreach/template", {
      outreachTemplateId: modeloAtual.id,
      outreachTemplateName: modeloAtual.name,
      outreachTemplateLanguage: modeloAtual.language,
      outreachTemplateBody: modeloAtual.body,
      outreachTemplateParams: modeloAtual.params,
    })).data,
    onSuccess: () => {
      setErro(null);
      setAviso("Modelo salvo.");
      setFormModelo(null);
      void queryClient.invalidateQueries({ queryKey: ["platform-whatsapp-channel"] });
    },
    onError: (causa) => setErro(apiErrorMessage(causa)),
  });

  const [lista, setLista] = useState("");
  const [nomeDoDisparo, setNomeDoDisparo] = useState("");
  const [tratamentoReserva, setTratamentoReserva] = useState("tudo bem");
  const [limiteDiario, setLimiteDiario] = useState(200);
  const [intervaloMinimo, setIntervaloMinimo] = useState(15);
  const [intervaloMaximo, setIntervaloMaximo] = useState(30);
  const [respeitarHorario, setRespeitarHorario] = useState(true);
  const [conferencia, setConferencia] = useState<Conferencia | null>(null);

  const conferir = useMutation({
    mutationFn: async () => (await api.post("/platform/whatsapp/outreach/analyze", { contacts: lista })).data as Conferencia,
    onSuccess: (dados) => {
      setErro(null);
      setConferencia(dados);
    },
    onError: (causa) => setErro(apiErrorMessage(causa)),
  });

  const criarDisparo = useMutation({
    mutationFn: async () => (await api.post("/platform/whatsapp/outreach/campaigns", {
      name: nomeDoDisparo,
      contacts: lista,
      fallbackName: tratamentoReserva,
      dailyLimit: limiteDiario,
      minIntervalSeconds: intervaloMinimo,
      maxIntervalSeconds: intervaloMaximo,
      respectBusinessHours: respeitarHorario,
    })).data,
    onSuccess: () => {
      setErro(null);
      setAviso("Disparo criado. Ele só começa a enviar quando você mandar começar.");
      setLista("");
      setNomeDoDisparo("");
      setConferencia(null);
      void queryClient.invalidateQueries({ queryKey: ["platform-outreach-campaigns"] });
    },
    onError: (causa) => setErro(apiErrorMessage(causa)),
  });

  const acaoNoDisparo = useMutation({
    mutationFn: async ({ id, acao }: { id: string; acao: "start" | "pause" | "cancel" }) => (
      acao === "cancel"
        ? (await api.delete(`/platform/whatsapp/outreach/campaigns/${id}`)).data
        : (await api.post(`/platform/whatsapp/outreach/campaigns/${id}/${acao}`)).data
    ),
    onSuccess: () => {
      setErro(null);
      void queryClient.invalidateQueries({ queryKey: ["platform-outreach-campaigns"] });
    },
    onError: (causa) => setErro(apiErrorMessage(causa)),
  });

  const [numeroParaBloquear, setNumeroParaBloquear] = useState("");
  const bloquear = useMutation({
    mutationFn: async () => (await api.post("/platform/whatsapp/outreach/blocks", { phone: numeroParaBloquear })).data,
    onSuccess: () => {
      setErro(null);
      setNumeroParaBloquear("");
      void queryClient.invalidateQueries({ queryKey: ["platform-outreach-blocks"] });
    },
    onError: (causa) => setErro(apiErrorMessage(causa)),
  });
  const desbloquear = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/platform/whatsapp/outreach/blocks/${id}`)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["platform-outreach-blocks"] }),
    onError: (causa) => setErro(apiErrorMessage(causa)),
  });

  const variaveisUsadas = (modeloAtual.body.match(/\{\{\s*\d+\s*\}\}/g) ?? []).length;
  const faltamVariaveis = variaveisUsadas > modeloAtual.params.length;

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">Prospecção ativa</p>
        <h2 className="mt-1 text-2xl font-black text-slate-950 dark:text-slate-100">Abordar uma lista de números</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
          Cole os números, confira o que foi lido e dispare. A primeira mensagem sai pelo modelo aprovado na Meta;
          quando a pessoa responde, o assistente assume a conversa como vendedor e passa para a equipe quando ela pedir.
        </p>
      </div>

      {erro && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">{erro}</p>}
      {aviso && <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">{aviso}</p>}

      {/*
        O aviso do modelo vem antes de tudo porque é a única trava que não dá
        para contornar pela tela: sem modelo aprovado, número novo não recebe
        nada, e o disparo falharia contato por contato.
      */}
      {!modelo?.configured && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800/70 dark:bg-amber-950/30">
          <p className="text-sm font-black text-amber-900 dark:text-amber-200">Nenhum modelo aprovado cadastrado</p>
          <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-300/90">
            O WhatsApp só aceita texto livre nas 24 horas seguintes à mensagem da pessoa. Para falar com quem nunca
            escreveu, submeta um modelo no painel do Gupshup, espere a aprovação da Meta e cadastre aqui embaixo.
          </p>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-600 dark:text-brand-400">Passo 1</p>
          <h3 className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">Modelo aprovado da abertura</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
            Cadastre exatamente o que a Meta aprovou. Texto diferente do aprovado é recusado no envio.
          </p>
        </div>
        <CardContent className="space-y-4 pt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Id do modelo (Gupshup)">
              <Input value={modeloAtual.id} placeholder="cole o id que aparece no painel do Gupshup" onChange={(evento) => setFormModelo({ ...modeloAtual, id: evento.target.value })} />
            </FormField>
            <FormField label="Nome do modelo (Meta)">
              <Input value={modeloAtual.name} placeholder="ex.: abordagem_chegowia_v1" onChange={(evento) => setFormModelo({ ...modeloAtual, name: evento.target.value })} />
            </FormField>
          </div>
          <FormField label="Texto do modelo, como foi aprovado">
            <Textarea rows={3} className="min-h-[94px]" value={modeloAtual.body} placeholder="Oi {{1}}, aqui é a ChegowIA…" onChange={(evento) => setFormModelo({ ...modeloAtual, body: evento.target.value })} />
          </FormField>
          <div>
            <p className="text-sm font-black text-slate-900 dark:text-slate-100">O que entra em cada variável</p>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Na ordem: a primeira marcada preenche {"{{1}}"}, a segunda {"{{2}}"}, e assim por diante.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {VARIAVEIS.map((variavel) => {
                const posicao = modeloAtual.params.indexOf(variavel);
                return (
                  <button
                    key={variavel}
                    type="button"
                    onClick={() => setFormModelo({
                      ...modeloAtual,
                      params: posicao >= 0
                        ? modeloAtual.params.filter((item) => item !== variavel)
                        : [...modeloAtual.params, variavel],
                    })}
                    className={clsx(
                      "rounded-full border px-3 py-1.5 text-xs font-black transition",
                      posicao >= 0
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "border-slate-200 bg-white text-slate-600 hover:border-emerald-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
                    )}
                  >
                    {posicao >= 0 ? `${posicao + 1}. ${variavel}` : variavel}
                  </button>
                );
              })}
            </div>
            {faltamVariaveis && (
              <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                O texto tem {variaveisUsadas} variável(is) e você marcou {modeloAtual.params.length}. A Meta recusa o
                envio quando falta parâmetro.
              </p>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
            <p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Sugestões para submeter à aprovação</p>
            <div className="mt-2 space-y-3">
              {MODELOS_SUGERIDOS.map((sugestao) => (
                <div key={sugestao.titulo} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                  <p className="text-xs font-black text-slate-700 dark:text-slate-300">{sugestao.titulo}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{sugestao.corpo}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => setFormModelo({
                      ...modeloAtual,
                      body: sugestao.corpo,
                      params: sugestao.corpo.includes("{{2}}") ? ["nome", "cidade"] : ["nome"],
                    })}
                  >
                    Usar este texto
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
        <CardActions description="Categoria do modelo no Gupshup: marketing. Envio de marketing é cobrado por mensagem pela Meta e aparece no relatório de consumo da plataforma.">
          <Button type="button" isLoading={salvarModelo.isPending} onClick={() => salvarModelo.mutate()}>Salvar modelo</Button>
        </CardActions>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-600 dark:text-brand-400">Passo 2</p>
          <h3 className="mt-1 text-xl font-black text-slate-950 dark:text-slate-100">A lista de números</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
            Um contato por linha. Pode colar só os números ou trazer nome e cidade — “Pizzaria do Zé - Goiânia - (62) 99999-8888”.
          </p>
        </div>
        <CardContent className="space-y-4 pt-5">
          <FormField label="Nome deste disparo">
            <Input value={nomeDoDisparo} placeholder="ex.: Restaurantes do setor Bueno" onChange={(evento) => setNomeDoDisparo(evento.target.value)} />
          </FormField>
          <FormField label="Contatos">
            <Textarea
              rows={8}
              className="min-h-[190px] font-mono text-xs"
              value={lista}
              placeholder={"Pizzaria do Zé - Goiânia - (62) 99999-8888\nBar do João | 62 98888-7777\n62 97777-6666"}
              onChange={(evento) => { setLista(evento.target.value); setConferencia(null); }}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Tratamento sem nome">
              <Input value={tratamentoReserva} onChange={(evento) => setTratamentoReserva(evento.target.value)} />
            </FormField>
            <FormField label="Máximo por dia">
              <Input type="number" min={1} max={1000} value={limiteDiario} onChange={(evento) => setLimiteDiario(Number(evento.target.value))} />
            </FormField>
            <FormField label="Intervalo mínimo (s)">
              <Input type="number" min={5} value={intervaloMinimo} onChange={(evento) => setIntervaloMinimo(Number(evento.target.value))} />
            </FormField>
            <FormField label="Intervalo máximo (s)">
              <Input type="number" min={5} value={intervaloMaximo} onChange={(evento) => setIntervaloMaximo(Number(evento.target.value))} />
            </FormField>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={respeitarHorario} onChange={(evento) => setRespeitarHorario(evento.target.checked)} />
            <span>
              <span className="block text-sm font-black text-slate-900 dark:text-slate-100">Só enviar de segunda a sábado, das 9h às 20h</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                Mensagem comercial de madrugada é o que mais rende denúncia, e denúncia derruba o número que também
                atende o suporte. Fora da janela o disparo fica parado e retoma sozinho.
              </span>
            </span>
          </label>

          {conferencia && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-sm font-black text-slate-900 dark:text-slate-100">
                {conferencia.aptos} de {conferencia.total} número(s) vão receber
              </p>
              <div className="mt-2 space-y-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                {conferencia.repetidosNaLista > 0 && <p>{conferencia.repetidosNaLista} repetido(s) na própria lista, contados uma vez só.</p>}
                {conferencia.descartados.length > 0 && (
                  <div>
                    <p className="font-semibold">Fora do disparo:</p>
                    <ul className="mt-1 space-y-0.5">
                      {conferencia.descartados.slice(0, 12).map((item) => (
                        <li key={item.phone}>{item.phone} — {item.motivo}</li>
                      ))}
                    </ul>
                    {conferencia.descartados.length > 12 && <p className="mt-1">e outros {conferencia.descartados.length - 12}.</p>}
                  </div>
                )}
                {conferencia.recusados.length > 0 && (
                  <div>
                    <p className="font-semibold text-rose-700 dark:text-rose-300">Não deu para ler:</p>
                    <ul className="mt-1 space-y-0.5">
                      {conferencia.recusados.slice(0, 12).map((item, indice) => (
                        <li key={`${item.texto}-${indice}`}>“{item.texto}” — {item.motivo}</li>
                      ))}
                    </ul>
                    {conferencia.recusados.length > 12 && <p className="mt-1">e outras {conferencia.recusados.length - 12} linha(s).</p>}
                  </div>
                )}
                {conferencia.possiveisFixos.length > 0 && (
                  <p>{conferencia.possiveisFixos.length} parece(m) telefone fixo, que quase nunca tem WhatsApp: {conferencia.possiveisFixos.slice(0, 6).join(", ")}.</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
        <CardActions description="Criar o disparo não envia nada: ele nasce parado, e você decide quando começa.">
          <Button type="button" variant="outline" isLoading={conferir.isPending} disabled={lista.trim().length < 8} onClick={() => conferir.mutate()}>Conferir lista</Button>
          <Button type="button" isLoading={criarDisparo.isPending} disabled={lista.trim().length < 8 || nomeDoDisparo.trim().length < 3} onClick={() => criarDisparo.mutate()}>Criar disparo</Button>
        </CardActions>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h3 className="text-xl font-black text-slate-950 dark:text-slate-100">Disparos</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">Um envio por vez, com intervalo sorteado. Fechar a tela não interrompe.</p>
        </div>
        <CardContent className="space-y-3 pt-5">
          {carregandoCampanhas && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando…</p>}
          {!carregandoCampanhas && campanhas.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-center dark:border-slate-700">
              <p className="text-sm font-black text-slate-700 dark:text-slate-300">Nenhum disparo ainda</p>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Cole uma lista acima para começar.</p>
            </div>
          )}
          {campanhas.map((campanha) => (
            <div key={campanha.id} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-black text-slate-900 dark:text-slate-100">{campanha.name}</p>
                    <span className={clsx("rounded-full px-2.5 py-1 text-[10px] font-black", STATUS_COR[campanha.status])}>{STATUS_ROTULO[campanha.status]}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {campanha.createdByName ? `${campanha.createdByName} · ` : ""}{formatDateTime(campanha.createdAt)}
                    {" · "}até {campanha.dailyLimit}/dia, {campanha.minIntervalSeconds}–{campanha.maxIntervalSeconds}s entre envios
                    {campanha.respectBusinessHours ? ", em horário comercial" : ", sem restrição de horário"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {campanha.status !== "CONCLUIDA" && campanha.status !== "CANCELADA" && (
                    <>
                      {campanha.status === "ENVIANDO" ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => acaoNoDisparo.mutate({ id: campanha.id, acao: "pause" })}>Pausar</Button>
                      ) : (
                        <Button type="button" size="sm" onClick={() => acaoNoDisparo.mutate({ id: campanha.id, acao: "start" })}>
                          {campanha.status === "PAUSADA" ? "Retomar" : "Começar"}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-rose-200 text-rose-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/30"
                        onClick={() => acaoNoDisparo.mutate({ id: campanha.id, acao: "cancel" })}
                      >
                        Cancelar
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Contador rotulo="Na fila" valor={campanha.pendingCount} />
                <Contador rotulo="Enviados" valor={campanha.sentCount} />
                <Contador rotulo="Responderam" valor={campanha.repliedCount} destaque />
                <Contador rotulo="Falharam" valor={campanha.failedCount} />
              </div>
              {campanha.pausedReason && (
                <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">{campanha.pausedReason}</p>
              )}
              {campanha.status === "ENVIANDO" && campanha.nextSendAt && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Próximo envio a partir de {formatDateTime(campanha.nextSendAt)}.</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h3 className="text-xl font-black text-slate-950 dark:text-slate-100">Não contatar</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
            Quem pede para não receber entra aqui sozinho e sai de todos os disparos, inclusive dos que ainda não começaram.
          </p>
        </div>
        <CardContent className="space-y-3 pt-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <FormField label="Adicionar um número à mão">
                <Input value={numeroParaBloquear} placeholder="(62) 99999-8888" onChange={(evento) => setNumeroParaBloquear(evento.target.value)} />
              </FormField>
            </div>
            <Button type="button" variant="outline" isLoading={bloquear.isPending} disabled={numeroParaBloquear.replace(/\D/g, "").length < 10} onClick={() => bloquear.mutate()}>Bloquear</Button>
          </div>
          {bloqueios.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">Ninguém pediu para sair até agora.</p>}
          {bloqueios.map((bloqueio) => (
            <div key={bloqueio.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900 dark:text-slate-100">{bloqueio.phoneFormatted}</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {bloqueio.reason || "sem motivo registrado"}
                  {bloqueio.blockedByName ? ` · ${bloqueio.blockedByName}` : ""}
                  {" · "}{formatDateTime(bloqueio.createdAt)}
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => desbloquear.mutate(bloqueio.id)}>Remover</Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

function Contador({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className={clsx(
      "rounded-xl border px-3 py-2",
      destaque
        ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30"
        : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/50",
    )}>
      <p className="text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{rotulo}</p>
      <p className={clsx("mt-0.5 text-lg font-black", destaque ? "text-emerald-700 dark:text-emerald-300" : "text-slate-900 dark:text-slate-100")}>{valor}</p>
    </div>
  );
}
