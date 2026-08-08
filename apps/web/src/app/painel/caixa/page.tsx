"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CashMovementType, CashSessionStatus } from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { CashHistoryResponse, CashRegister, CashSessionListItem, CashSessionReport } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { parseCurrencyInput } from "@/lib/brazilian-format";
import { Card, CardActions, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/brazil-fields";
import { Modal } from "@/components/ui/modal";
import { Tabs } from "@/components/ui/tabs";
import { toneCard } from "@/lib/surface";

export default function CaixaPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [registerId, setRegisterId] = useState("");
  const [openingAmount, setOpeningAmount] = useState("");
  const [movement, setMovement] = useState({
    type: CashMovementType.SANGRIA as CashMovementType,
    amount: "",
    reason: "",
  });
  const [countedAmount, setCountedAmount] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [newRegisterName, setNewRegisterName] = useState("");
  const [aba, setAba] = useState<"turno" | "historico">("turno");

  const { data: registers, isLoading: loadingRegisters } = useQuery({
    queryKey: ["cash-registers"],
    queryFn: async () => (await api.get<CashRegister[]>("/caixa/pontos")).data,
  });

  useEffect(() => {
    if (!registerId && registers?.length) setRegisterId(registers[0].id);
  }, [registerId, registers]);

  const { data: session } = useQuery({
    queryKey: ["cash-session", registerId],
    queryFn: async () => (await api.get("/caixa/turnos/atual", { params: { cashRegisterId: registerId } })).data,
    enabled: Boolean(registerId),
    refetchInterval: 30_000,
  });

  const { data: report } = useQuery({
    queryKey: ["cash-report", session?.id],
    queryFn: async () => (await api.get<CashSessionReport>(`/caixa/turnos/${session.id}`)).data,
    enabled: Boolean(session?.id),
    refetchInterval: 30_000,
  });

  function feedback(mensagem: string) {
    setError(null);
    setSuccess(mensagem);
    queryClient.invalidateQueries({ queryKey: ["cash-session"] });
    queryClient.invalidateQueries({ queryKey: ["cash-report"] });
    queryClient.invalidateQueries({ queryKey: ["cash-registers"] });
  }
  const falhou = (err: unknown) => { setSuccess(null); setError(apiErrorMessage(err)); };

  const createRegister = useMutation({
    mutationFn: async () => (await api.post<CashRegister>("/caixa/pontos", { name: newRegisterName })).data,
    onSuccess: (criado) => {
      setNewRegisterName("");
      setRegisterModalOpen(false);
      // Selecionar o recém-criado poupa o passo de procurá-lo na lista.
      setRegisterId(criado.id);
      feedback("Ponto de venda criado.");
    },
    onError: falhou,
  });

  const open = useMutation({
    mutationFn: async () => (await api.post("/caixa/turnos", {
      cashRegisterId: registerId,
      openingAmount: parseCurrencyInput(openingAmount),
    })).data,
    onSuccess: () => { setOpeningAmount(""); feedback("Turno aberto."); },
    onError: falhou,
  });

  const addMovement = useMutation({
    mutationFn: async () => (await api.post(`/caixa/turnos/${session.id}/movimentos`, {
      type: movement.type,
      amount: parseCurrencyInput(movement.amount),
      reason: movement.reason,
    })).data,
    onSuccess: () => {
      setMovement({ type: CashMovementType.SANGRIA, amount: "", reason: "" });
      feedback("Movimentação registrada.");
    },
    onError: falhou,
  });

  const close = useMutation({
    mutationFn: async () => (await api.post(`/caixa/turnos/${session.id}/fechar`, {
      countedAmount: parseCurrencyInput(countedAmount),
      notes: closingNotes || undefined,
    })).data,
    onSuccess: () => { setCountedAmount(""); setClosingNotes(""); feedback("Turno fechado."); },
    onError: falhou,
  });

  const aberto = session?.status === CashSessionStatus.ABERTO;
  const semPontos = !loadingRegisters && (registers?.length ?? 0) === 0;
  const diferenca = report && countedAmount
    ? parseCurrencyInput(countedAmount) - report.expected.cash
    : null;
  const pontoAtual = registers?.find((registro) => registro.id === registerId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Caixa</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Abertura, sangria, suprimento e fechamento com conferência por ponto de venda.
          </p>
        </div>
        {/*
          Criar ponto de venda é configuração, feita uma vez. Ficava num campo ao
          lado do seletor, como se fosse parte de escolher o caixa do dia — duas
          ações de frequência muito diferente competindo na mesma linha.
        */}
        {!semPontos && (
          <Button variant="outline" onClick={() => setRegisterModalOpen(true)}>
            Novo ponto de venda
          </Button>
        )}
      </div>

      <Tabs
        value={aba}
        onChange={setAba}
        items={[
          { value: "turno", label: "Turno atual" },
          { value: "historico", label: "Histórico" },
        ]}
      />

      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300">{error}</p>}
      {success && <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">{success}</p>}

      {aba === "turno" && (semPontos ? (
        <Card className={toneCard("brand")}>
          <CardContent className="space-y-4 py-10 text-center">
            <p className="text-lg font-black text-slate-900 dark:text-slate-100">
              Nenhum ponto de venda cadastrado
            </p>
            <p className="mx-auto max-w-md text-sm text-slate-600 dark:text-slate-300">
              O caixa é controlado por ponto de venda: balcão e delivery fecham separados, senão
              uma diferença na gaveta não tem dono. Comece criando o primeiro.
            </p>
            <Button onClick={() => setRegisterModalOpen(true)}>Criar ponto de venda</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>Ponto de venda</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Caixa em operação">
              <Select value={registerId} onChange={(e) => setRegisterId(e.target.value)}>
                {registers?.map((registro) => (
                  <option key={registro.id} value={registro.id}>
                    {registro.name}{registro.isActive ? "" : " (inativo)"}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="flex items-end">
              <p className="pb-2 text-sm text-slate-500 dark:text-slate-400">
                {aberto && report
                  ? `Turno aberto desde ${new Date(report.openedAt).toLocaleString("pt-BR")}.`
                  : `${pontoAtual?.name ?? "Este caixa"} está fechado.`}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}

      {aba === "turno" && !semPontos && !aberto && (
        <Card>
          <CardHeader><CardTitle>Abrir turno</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Informe quanto já existe em dinheiro na gaveta (fundo de troco). É a partir daqui que a
              conferência do fim do turno é calculada.
            </p>
            <div className="max-w-xs">
              <FormField label="Valor de abertura">
                <CurrencyInput value={openingAmount} onValueChange={setOpeningAmount} />
              </FormField>
            </div>
          </CardContent>
          <CardActions>
            <Button className="w-full sm:w-auto" onClick={() => open.mutate()} disabled={!registerId || open.isPending}>
              {open.isPending ? "Abrindo..." : "Abrir turno"}
            </Button>
          </CardActions>
        </Card>
      )}

      {aba === "turno" && aberto && report && (
        <>
          <ResultadoTurno relatorio={report} />

          <Card>
            <CardHeader><CardTitle>Sangria e suprimento</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FormField label="Tipo">
                  <Select
                    value={movement.type}
                    onChange={(e) => setMovement((m) => ({ ...m, type: e.target.value as CashMovementType }))}
                  >
                    <option value={CashMovementType.SANGRIA}>Sangria (retirada)</option>
                    <option value={CashMovementType.SUPRIMENTO}>Suprimento (entrada)</option>
                    <option value={CashMovementType.AJUSTE}>Ajuste</option>
                  </Select>
                </FormField>
                <FormField label="Valor">
                  <CurrencyInput
                    value={movement.amount}
                    onValueChange={(valor) => setMovement((m) => ({ ...m, amount: valor }))}
                  />
                </FormField>
                <FormField label="Motivo">
                  <Input
                    value={movement.reason}
                    onChange={(e) => setMovement((m) => ({ ...m, reason: e.target.value }))}
                    placeholder="Levar ao cofre"
                  />
                </FormField>
              </div>
              {report.movements.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {report.movements.map((mov) => (
                    <li key={mov.id} className="flex justify-between border-b border-slate-100 py-1 dark:border-slate-800">
                      <span className="text-slate-600 dark:text-slate-300">
                        {mov.type === CashMovementType.SANGRIA ? "−" : "+"} {mov.reason}
                      </span>
                      <span className="font-semibold tabular-nums">{formatCurrency(mov.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
            <CardActions>
              <Button
                className="w-full sm:w-auto"
                variant="outline"
                onClick={() => addMovement.mutate()}
                disabled={parseCurrencyInput(movement.amount) <= 0 || movement.reason.trim().length < 3}
              >
                Registrar movimentação
              </Button>
            </CardActions>
          </Card>

          <Card>
            <CardHeader><CardTitle>Fechar turno</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="max-w-xs">
                <FormField label="Valor contado na gaveta">
                  <CurrencyInput value={countedAmount} onValueChange={setCountedAmount} />
                </FormField>
              </div>
              {diferenca !== null && (
                <p className={diferenca === 0
                  ? "text-sm font-bold text-emerald-600 dark:text-emerald-400"
                  : "text-sm font-bold text-amber-600 dark:text-amber-400"}>
                  {diferenca === 0
                    ? "Confere com o esperado."
                    : `${diferenca > 0 ? "Sobra" : "Falta"} de ${formatCurrency(Math.abs(diferenca))}.`}
                </p>
              )}
              <FormField label="Observações">
                <Textarea value={closingNotes} onChange={(e) => setClosingNotes(e.target.value)} />
              </FormField>
            </CardContent>
            <CardActions>
              <Button className="w-full sm:w-auto" onClick={() => close.mutate()} disabled={!countedAmount || close.isPending}>
                {close.isPending ? "Fechando..." : "Fechar turno"}
              </Button>
            </CardActions>
          </Card>
        </>
      )}

      {aba === "historico" && <Historico registers={registers ?? []} />}

      <Modal open={registerModalOpen} onClose={() => setRegisterModalOpen(false)} title="Novo ponto de venda">
        <div className="space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Cada ponto de venda tem turno e conferência próprios. Use nomes que a equipe reconheça
            no dia a dia — &quot;Balcão&quot;, &quot;Delivery&quot;, &quot;Salão&quot;.
          </p>
          <FormField label="Nome">
            <Input
              autoFocus
              placeholder="Balcão"
              value={newRegisterName}
              onChange={(e) => setNewRegisterName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newRegisterName.trim().length >= 2) createRegister.mutate();
              }}
            />
          </FormField>
          <div className="flex gap-2">
            <Button
              onClick={() => createRegister.mutate()}
              disabled={newRegisterName.trim().length < 2 || createRegister.isPending}
            >
              {createRegister.isPending ? "Criando..." : "Criar"}
            </Button>
            <Button variant="outline" onClick={() => setRegisterModalOpen(false)}>Cancelar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}


/**
 * Resultado do turno.
 *
 * Separa o que é **caixa** (dinheiro na gaveta) do que é **resultado**
 * (faturamento, margem, perdas). Misturar os dois é o erro clássico do
 * fechamento: cartão entra no faturamento mas não na gaveta, e quem soma tudo
 * fecha achando que faltou dinheiro.
 */
function ResultadoTurno({ relatorio }: { relatorio: CashSessionReport }) {
  return (
    <>
      <Card>
        <CardHeader><CardTitle>Faturamento do turno</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric label="Vendido" value={formatCurrency(relatorio.sales.total)} destaque />
          <Metric label="Pedidos" value={String(relatorio.sales.orderCount)} />
          <Metric label="Ticket médio" value={formatCurrency(relatorio.sales.averageTicket)} />
          <Metric label="Entregas" value={formatCurrency(relatorio.sales.delivery)} />
          <Metric label="Dinheiro" value={formatCurrency(relatorio.expected.cash)} />
          <Metric label="Cartão" value={formatCurrency(relatorio.expected.card)} />
          <Metric label="Pix" value={formatCurrency(relatorio.expected.pix)} />
          <Metric label="Descontos" value={formatCurrency(relatorio.sales.discount)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Margem</CardTitle></CardHeader>
        <CardContent>
          {relatorio.margin.available ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label="Produtos vendidos" value={formatCurrency(relatorio.sales.products)} />
              <Metric label="Custo (CMV)" value={formatCurrency(relatorio.margin.cost)} />
              <Metric label="Lucro bruto" value={formatCurrency(relatorio.margin.grossProfit ?? 0)} destaque />
              <Metric label="Margem" value={`${relatorio.margin.grossMarginPercent ?? 0}%`} />
            </div>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {relatorio.margin.itemsTotal === 0
                ? "Nenhuma venda ainda neste turno."
                : `${relatorio.margin.itemsWithoutCost} de ${relatorio.margin.itemsTotal} itens vendidos não têm custo cadastrado.`}
              {relatorio.margin.itemsTotal > 0 && (
                <>
                  {" "}Cadastre o custo em Cardápio para acompanhar a margem — com custo parcial o
                  número sairia inflado e pareceria confiável.
                </>
              )}
            </p>
          )}
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            Margem bruta: preço de venda menos custo dos produtos. Aluguel, folha, energia e
            impostos não entram aqui, então isto não é lucro líquido.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Perdas e pendências</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric
            label="Cancelados"
            value={formatCurrency(relatorio.losses.cancelled)}
            hint={`${relatorio.losses.cancelledCount} pedido(s)`}
            alerta={relatorio.losses.cancelled > 0}
          />
          <Metric
            label="Não pagos"
            value={formatCurrency(relatorio.losses.unpaid)}
            hint={`${relatorio.losses.unpaidCount} pedido(s) em aberto`}
            alerta={relatorio.losses.unpaid > 0}
          />
          <Metric label="Sangrias" value={formatCurrency(relatorio.cashFlow.withdrawal)} />
          <Metric label="Suprimentos" value={formatCurrency(relatorio.cashFlow.supply)} />
        </CardContent>
      </Card>
    </>
  );
}

/**
 * Histórico de turnos.
 *
 * Mostra o resumo direto na linha em vez de exigir abrir cada turno: a razão
 * de existir a tela é comparar dias, e comparação que precisa de sete cliques
 * não acontece.
 */
function Historico({ registers }: { registers: CashRegister[] }) {
  // A data é lida no inicializador do estado, não no corpo do componente: ler
  // o relógio a cada render torna o valor diferente entre servidor e cliente e
  // provoca erro de hidratação.
  const [filtros, setFiltros] = useState(() => ({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
    cashRegisterId: "",
  }));

  const { data, isLoading } = useQuery({
    queryKey: ["cash-history", filtros],
    queryFn: async () => (await api.get<CashHistoryResponse>("/caixa/turnos", {
      params: {
        from: filtros.from,
        to: filtros.to,
        cashRegisterId: filtros.cashRegisterId || undefined,
        status: CashSessionStatus.FECHADO,
      },
    })).data,
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Período</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="De">
            <Input type="date" value={filtros.from} onChange={(e) => setFiltros((f) => ({ ...f, from: e.target.value }))} />
          </FormField>
          <FormField label="Até">
            <Input type="date" value={filtros.to} onChange={(e) => setFiltros((f) => ({ ...f, to: e.target.value }))} />
          </FormField>
          <FormField label="Ponto de venda">
            <Select
              value={filtros.cashRegisterId}
              onChange={(e) => setFiltros((f) => ({ ...f, cashRegisterId: e.target.value }))}
            >
              <option value="">Todos</option>
              {registers.map((registro) => (
                <option key={registro.id} value={registro.id}>{registro.name}</option>
              ))}
            </Select>
          </FormField>
        </CardContent>
      </Card>

      {data && data.items.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Total do período</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Turnos" value={String(data.totals.sessions)} />
            <Metric label="Faturamento" value={formatCurrency(data.totals.revenue)} destaque />
            <Metric label="Pedidos" value={String(data.totals.orderCount)} />
            <Metric
              label="Lucro bruto"
              value={data.totals.grossProfit === null ? "—" : formatCurrency(data.totals.grossProfit)}
              hint={data.totals.grossProfit === null ? "custo incompleto" : undefined}
            />
            <Metric
              label="Cancelados"
              value={formatCurrency(data.totals.cancelled)}
              alerta={data.totals.cancelled > 0}
            />
            <Metric
              label="Quebra de caixa"
              value={formatCurrency(data.totals.difference)}
              hint={data.totals.difference < 0 ? "falta acumulada" : data.totals.difference > 0 ? "sobra acumulada" : undefined}
              alerta={data.totals.difference !== 0}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Turnos fechados</CardTitle></CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>}
          {!isLoading && data?.items.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Nenhum turno fechado neste período.
            </p>
          )}
          <div className="space-y-3">
            {data?.items.map((turno) => <LinhaHistorico key={turno.id} turno={turno} />)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LinhaHistorico({ turno }: { turno: CashSessionListItem }) {
  const [aberto, setAberto] = useState(false);
  const diferenca = turno.difference ?? 0;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800">
      <button
        onClick={() => setAberto((atual) => !atual)}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <p className="font-bold text-slate-900 dark:text-slate-100">
            {turno.cashRegister.name}
            <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
              {new Date(turno.openedAt).toLocaleString("pt-BR")}
              {turno.closedAt ? ` → ${new Date(turno.closedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}
            </span>
          </p>
          {turno.summary && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {turno.summary.sales.orderCount} pedido(s) · ticket médio {formatCurrency(turno.summary.sales.averageTicket)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Faturamento</p>
            <p className="font-black tabular-nums text-slate-900 dark:text-slate-100">
              {turno.summary ? formatCurrency(turno.summary.sales.total) : "—"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Conferência</p>
            <p className={
              diferenca === 0
                ? "font-black tabular-nums text-emerald-600 dark:text-emerald-400"
                : "font-black tabular-nums text-amber-600 dark:text-amber-400"
            }>
              {diferenca === 0 ? "Confere" : `${diferenca > 0 ? "+" : "−"}${formatCurrency(Math.abs(diferenca))}`}
            </p>
          </div>
          <span aria-hidden className="text-slate-400">{aberto ? "▲" : "▼"}</span>
        </div>
      </button>

      {aberto && (
        <div className="border-t border-slate-100 px-4 py-4 dark:border-slate-800">
          {turno.summary ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label="Abertura" value={formatCurrency(turno.openingAmount)} />
              <Metric label="Dinheiro esperado" value={formatCurrency(turno.summary.expected.cash)} />
              <Metric label="Contado" value={formatCurrency(turno.countedAmount ?? 0)} />
              <Metric label="Cartão" value={formatCurrency(turno.summary.expected.card)} />
              <Metric label="Pix" value={formatCurrency(turno.summary.expected.pix)} />
              <Metric
                label="Lucro bruto"
                value={turno.summary.margin.grossProfit === null ? "—" : formatCurrency(turno.summary.margin.grossProfit)}
                hint={turno.summary.margin.available ? `${turno.summary.margin.grossMarginPercent}% de margem` : "custo incompleto"}
              />
              <Metric
                label="Cancelados"
                value={formatCurrency(turno.summary.losses.cancelled)}
                alerta={turno.summary.losses.cancelled > 0}
              />
              <Metric label="Sangrias" value={formatCurrency(turno.summary.cashFlow.withdrawal)} />
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Este turno foi fechado antes do resumo detalhado existir. Refazer a conta hoje daria
              um número diferente do que foi conferido na época, então ele não é recalculado.
            </p>
          )}
          {turno.notes && (
            <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              {turno.notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  destaque,
  hint,
  alerta,
}: {
  label: string;
  value: string;
  destaque?: boolean;
  hint?: string;
  alerta?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={
        destaque
          ? "mt-1 text-xl font-black tabular-nums text-brand-600 dark:text-brand-400"
          : alerta
            ? "mt-1 text-xl font-black tabular-nums text-amber-600 dark:text-amber-400"
            : "mt-1 text-xl font-black tabular-nums text-slate-900 dark:text-slate-100"
      }>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}
