"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CFOP_OPTIONS,
  FISCAL_ENVIRONMENT_LABELS,
  FiscalEnvironment,
  PIS_COFINS_CST_OPTIONS,
  TAX_ORIGIN_LABELS,
  TAX_REGIME_LABELS,
  TaxOrigin,
  TaxRegime,
  UNIT_OPTIONS,
  icmsCodeOptions,
} from "@chegowia/shared";
import { api, apiErrorMessage } from "@/lib/api-client";
import { FiscalStatus, ProductTaxStatusResponse } from "@/lib/types";
import { Card, CardActions, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/input";
import { BrazilStateSelect, FileUpload, MaskedInput } from "@/components/ui/brazil-fields";

const EMPTY_FORM = {
  taxRegime: TaxRegime.SIMPLES_NACIONAL as TaxRegime,
  cnae: "",
  stateRegistration: "",
  municipalRegistration: "",
  legalName: "",
  tradeName: "",
  addressStreet: "",
  addressNumber: "",
  addressComplement: "",
  addressDistrict: "",
  cityIbgeCode: "",
  cityName: "",
  state: "",
  zipCode: "",
  environment: FiscalEnvironment.HOMOLOGACAO as FiscalEnvironment,
  nfceSeries: "1",
  autoEmit: false,
  cscId: "",
  cscToken: "",
  defaultNcm: "",
  defaultCest: "",
  defaultCfop: "5102",
  defaultTaxOrigin: TaxOrigin.NACIONAL as TaxOrigin,
  defaultIcmsCode: "",
  defaultIcmsRate: "",
  defaultPisCode: "",
  defaultPisRate: "",
  defaultCofinsCode: "",
  defaultCofinsRate: "",
  defaultUnit: "UN",
};

export function CadastroFiscal() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [certificatePassword, setCertificatePassword] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["fiscal-profile"],
    queryFn: async () => {
      const { data } = await api.get<FiscalStatus>("/fiscal/profile");
      return data;
    },
  });

  useEffect(() => {
    const profile = data?.profile;
    if (!profile) return;
    setForm({
      taxRegime: profile.taxRegime,
      cnae: profile.cnae ?? "",
      stateRegistration: profile.stateRegistration ?? "",
      municipalRegistration: profile.municipalRegistration ?? "",
      legalName: profile.legalName ?? "",
      tradeName: profile.tradeName ?? "",
      addressStreet: profile.addressStreet ?? "",
      addressNumber: profile.addressNumber ?? "",
      addressComplement: profile.addressComplement ?? "",
      addressDistrict: profile.addressDistrict ?? "",
      cityIbgeCode: profile.cityIbgeCode ?? "",
      cityName: profile.cityName ?? "",
      state: profile.state ?? "",
      zipCode: profile.zipCode ?? "",
      environment: profile.environment,
      nfceSeries: String(profile.nfceSeries ?? 1),
      autoEmit: Boolean(profile.autoEmit),
      cscId: profile.cscId ?? "",
      // O token nunca volta do servidor: em branco significa "manter o atual".
      cscToken: "",
      defaultNcm: profile.defaultNcm ?? "",
      defaultCest: profile.defaultCest ?? "",
      defaultCfop: profile.defaultCfop ?? "5102",
      defaultTaxOrigin: profile.defaultTaxOrigin ?? TaxOrigin.NACIONAL,
      defaultIcmsCode: profile.defaultIcmsCode ?? "",
      defaultIcmsRate: profile.defaultIcmsRate === null || profile.defaultIcmsRate === undefined ? "" : String(profile.defaultIcmsRate),
      defaultPisCode: profile.defaultPisCode ?? "",
      defaultPisRate: profile.defaultPisRate === null || profile.defaultPisRate === undefined ? "" : String(profile.defaultPisRate),
      defaultCofinsCode: profile.defaultCofinsCode ?? "",
      defaultCofinsRate: profile.defaultCofinsRate === null || profile.defaultCofinsRate === undefined ? "" : String(profile.defaultCofinsRate),
      defaultUnit: profile.defaultUnit ?? "UN",
    });
  }, [data?.profile]);

  const saveProfile = useMutation({
    mutationFn: async () => {
      const {
        cscToken, nfceSeries, municipalRegistration, tradeName, addressComplement, cscId,
        defaultNcm, defaultCest, defaultIcmsCode, defaultIcmsRate, defaultPisCode, defaultPisRate,
        defaultCofinsCode, defaultCofinsRate, ...rest
      } = form;
      // Campo em branco vira `undefined`: no backend a ausência é o que
      // significa "não definido", e string vazia gravaria um valor inútil.
      const texto = (value: string) => (value.trim() ? value.trim() : undefined);
      const numero = (value: string) => (value.trim() ? Number(value) : undefined);
      const { data } = await api.put("/fiscal/profile", {
        ...rest,
        nfceSeries: Number(nfceSeries) || 1,
        municipalRegistration: texto(municipalRegistration),
        tradeName: texto(tradeName),
        addressComplement: texto(addressComplement),
        cscId: texto(cscId),
        cscToken: texto(cscToken),
        defaultNcm: texto(defaultNcm),
        defaultCest: texto(defaultCest),
        defaultIcmsCode: texto(defaultIcmsCode),
        defaultIcmsRate: numero(defaultIcmsRate),
        defaultPisCode: texto(defaultPisCode),
        defaultPisRate: numero(defaultPisRate),
        defaultCofinsCode: texto(defaultCofinsCode),
        defaultCofinsRate: numero(defaultCofinsRate),
      });
      return data;
    },
    onSuccess: () => {
      setError(null);
      setSuccess("Cadastro fiscal atualizado.");
      setForm((current) => ({ ...current, cscToken: "" }));
      queryClient.invalidateQueries({ queryKey: ["fiscal-profile"] });
      // Mudar um padrão pode resolver a pendência de dezenas de itens de uma vez.
      queryClient.invalidateQueries({ queryKey: ["fiscal-products-pending"] });
    },
    onError: (err) => { setSuccess(null); setError(apiErrorMessage(err)); },
  });

  const { data: produtos } = useQuery({
    queryKey: ["fiscal-products-pending"],
    queryFn: async () => {
      const { data } = await api.get<ProductTaxStatusResponse>("/fiscal/products", {
        params: { pendentes: "true" },
      });
      return data;
    },
  });

  const uploadCertificate = useMutation({
    mutationFn: async () => {
      if (!certificateFile) throw new Error("Escolha o arquivo do certificado.");
      const body = new FormData();
      body.append("file", certificateFile);
      body.append("password", certificatePassword);
      const { data } = await api.post("/fiscal/certificate", body);
      return data;
    },
    onSuccess: () => {
      setError(null);
      setSuccess("Certificado digital atualizado.");
      setCertificateFile(null);
      setCertificatePassword("");
      queryClient.invalidateQueries({ queryKey: ["fiscal-profile"] });
    },
    onError: (err) => { setSuccess(null); setError(apiErrorMessage(err)); },
  });

  if (isLoading) return <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>;

  const certificate = data?.certificate ?? null;
  const pendencias = data?.readiness.pendencias ?? [];

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300">{error}</p>}
      {success && (
        <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">{success}</p>
      )}

      <StatusCard
        environment={data?.profile?.environment ?? FiscalEnvironment.HOMOLOGACAO}
        pendencias={pendencias}
        canEmit={Boolean(data?.readiness.canEmitInProduction)}
      />

      <Card>
        <CardHeader>
          <CardTitle>Certificado digital A1</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {certificate ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-800/50">
              <p className="font-bold text-slate-900 dark:text-slate-100">{certificate.subjectName}</p>
              <p className="mt-1 text-slate-500 dark:text-slate-400">Emitido por {certificate.issuerName}</p>
              <p className="mt-2 text-slate-600 dark:text-slate-300">
                Válido até {new Date(certificate.notAfter).toLocaleDateString("pt-BR")}
                {" · "}
                <ExpiryBadge days={certificate.daysUntilExpiry} />
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Nenhum certificado enviado. Sem ele não é possível assinar nota fiscal.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Arquivo do certificado">
              <FileUpload
                accept=".pfx,.p12"
                file={certificateFile}
                onFile={setCertificateFile}
                hint="Arquivo .pfx ou .p12 fornecido pela sua certificadora"
              />
            </FormField>
            <FormField label="Senha do certificado">
              <Input
                type="password"
                autoComplete="off"
                value={certificatePassword}
                onChange={(e) => setCertificatePassword(e.target.value)}
              />
            </FormField>
          </div>

          {/*
            O arquivo é a chave privada da empresa. Dizer isso na tela evita a
            pergunta óbvia de quem hesita antes de enviar.
          */}
          <p className="text-xs text-slate-400 dark:text-slate-500">
            O arquivo e a senha são guardados criptografados e nunca são exibidos de volta. Enviar um novo
            certificado substitui o atual, mantendo o anterior no histórico das notas já emitidas.
          </p>

        </CardContent>
        <CardActions>
          <Button
            className="w-full sm:w-auto"
            onClick={() => uploadCertificate.mutate()}
            disabled={!certificateFile || !certificatePassword || uploadCertificate.isPending}
          >
            {uploadCertificate.isPending ? "Enviando..." : certificate ? "Substituir certificado" : "Enviar certificado"}
          </Button>
        </CardActions>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dados do emitente</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Regime tributário">
            <Select value={form.taxRegime} onChange={(e) => setForm((f) => ({ ...f, taxRegime: e.target.value as TaxRegime }))}>
              {Object.entries(TAX_REGIME_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="CNAE principal">
            <Input
              inputMode="numeric"
              placeholder="5611201"
              value={form.cnae}
              onChange={(e) => setForm((f) => ({ ...f, cnae: e.target.value }))}
            />
          </FormField>
          <FormField label="Inscrição estadual">
            <Input
              placeholder="ISENTO ou o número da IE"
              value={form.stateRegistration}
              onChange={(e) => setForm((f) => ({ ...f, stateRegistration: e.target.value }))}
            />
          </FormField>
          <FormField label="Inscrição municipal">
            <Input
              value={form.municipalRegistration}
              onChange={(e) => setForm((f) => ({ ...f, municipalRegistration: e.target.value }))}
            />
          </FormField>
          <FormField label="Razão social">
            <Input value={form.legalName} onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))} />
          </FormField>
          <FormField label="Nome fantasia">
            <Input value={form.tradeName} onChange={(e) => setForm((f) => ({ ...f, tradeName: e.target.value }))} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Endereço fiscal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            É o endereço do CNPJ, que pode ser diferente do endereço de entrega mostrado ao cliente.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Logradouro">
              <Input value={form.addressStreet} onChange={(e) => setForm((f) => ({ ...f, addressStreet: e.target.value }))} />
            </FormField>
            <FormField label="Número">
              <Input value={form.addressNumber} onChange={(e) => setForm((f) => ({ ...f, addressNumber: e.target.value }))} />
            </FormField>
            <FormField label="Complemento">
              <Input value={form.addressComplement} onChange={(e) => setForm((f) => ({ ...f, addressComplement: e.target.value }))} />
            </FormField>
            <FormField label="Bairro">
              <Input value={form.addressDistrict} onChange={(e) => setForm((f) => ({ ...f, addressDistrict: e.target.value }))} />
            </FormField>
            <FormField label="Cidade">
              <Input value={form.cityName} onChange={(e) => setForm((f) => ({ ...f, cityName: e.target.value }))} />
            </FormField>
            <FormField label="Código IBGE do município">
              <Input
                inputMode="numeric"
                placeholder="3106200"
                value={form.cityIbgeCode}
                onChange={(e) => setForm((f) => ({ ...f, cityIbgeCode: e.target.value }))}
              />
            </FormField>
            <FormField label="UF">
              <BrazilStateSelect value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} />
            </FormField>
            <FormField label="CEP">
              <MaskedInput mask="cep" value={form.zipCode} onChange={(e) => setForm((f) => ({ ...f, zipCode: e.target.value }))} />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Emissão de NFC-e</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Ambiente">
              <Select
                value={form.environment}
                onChange={(e) => setForm((f) => ({ ...f, environment: e.target.value as FiscalEnvironment }))}
              >
                {Object.entries(FISCAL_ENVIRONMENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Série">
              <Input
                type="number"
                min="1"
                max="999"
                value={form.nfceSeries}
                onChange={(e) => setForm((f) => ({ ...f, nfceSeries: e.target.value }))}
              />
            </FormField>
            <FormField label="Identificador do CSC">
              <Input
                inputMode="numeric"
                placeholder="000001"
                value={form.cscId}
                onChange={(e) => setForm((f) => ({ ...f, cscId: e.target.value }))}
              />
            </FormField>
            <FormField label={data?.profile?.hasCscToken ? "Token do CSC (deixe em branco para manter)" : "Token do CSC"}>
              <Input
                type="password"
                autoComplete="off"
                value={form.cscToken}
                onChange={(e) => setForm((f) => ({ ...f, cscToken: e.target.value }))}
              />
            </FormField>
          </div>
          <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-800 dark:text-slate-300">
            <span>
              Emitir automaticamente ao confirmar um pedido pago ou fechar uma mesa
              <span className="mt-0.5 block text-xs font-normal text-slate-400">
                Ligue só depois de testar em homologação — antes disso cada venda vira uma rejeição.
              </span>
            </span>
            <input
              type="checkbox"
              checked={form.autoEmit}
              onChange={(e) => setForm((f) => ({ ...f, autoEmit: e.target.checked }))}
            />
          </label>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            O próximo número da nota é controlado automaticamente pela emissão — a SEFAZ rejeita número
            repetido ou fora de sequência, então ele não é editável aqui.
            {data?.profile ? ` Próximo número: ${data.profile.nfceNextNumber}.` : ""}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tributação padrão do cardápio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Vale para todos os produtos. No cadastro de cada item você preenche só o que for
            diferente — normalmente o NCM de bebidas. Refeição pronta costuma ser 21069090.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="NCM padrão">
              <Input
                inputMode="numeric"
                placeholder="21069090"
                value={form.defaultNcm}
                onChange={(e) => setForm((f) => ({ ...f, defaultNcm: e.target.value }))}
              />
            </FormField>
            <FormField label="CEST padrão">
              <Input
                inputMode="numeric"
                value={form.defaultCest}
                onChange={(e) => setForm((f) => ({ ...f, defaultCest: e.target.value }))}
              />
            </FormField>
            <FormField label="CFOP padrão">
              <CodeSelect
                value={form.defaultCfop}
                onChange={(v) => setForm((f) => ({ ...f, defaultCfop: v }))}
                options={CFOP_OPTIONS}
              />
            </FormField>
            <FormField label="Origem padrão">
              <CodeSelect
                value={form.defaultTaxOrigin}
                onChange={(v) => setForm((f) => ({ ...f, defaultTaxOrigin: v as TaxOrigin }))}
                options={Object.entries(TAX_ORIGIN_LABELS).map(([code, label]) => ({ code, label }))}
              />
            </FormField>
            <FormField label={form.taxRegime === TaxRegime.REGIME_NORMAL ? "CST de ICMS padrão" : "CSOSN padrão"}>
              <CodeSelect
                value={form.defaultIcmsCode}
                onChange={(v) => setForm((f) => ({ ...f, defaultIcmsCode: v }))}
                options={icmsCodeOptions(form.taxRegime)}
                placeholder="Selecione"
              />
            </FormField>
            <FormField label="Alíquota de ICMS (%)">
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={form.defaultIcmsRate}
                onChange={(e) => setForm((f) => ({ ...f, defaultIcmsRate: e.target.value }))}
              />
            </FormField>
            <FormField label="CST de PIS padrão">
              <CodeSelect
                value={form.defaultPisCode}
                onChange={(v) => setForm((f) => ({ ...f, defaultPisCode: v }))}
                options={PIS_COFINS_CST_OPTIONS}
                placeholder="Selecione"
              />
            </FormField>
            <FormField label="Alíquota de PIS (%)">
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={form.defaultPisRate}
                onChange={(e) => setForm((f) => ({ ...f, defaultPisRate: e.target.value }))}
              />
            </FormField>
            <FormField label="CST de COFINS padrão">
              <CodeSelect
                value={form.defaultCofinsCode}
                onChange={(v) => setForm((f) => ({ ...f, defaultCofinsCode: v }))}
                options={PIS_COFINS_CST_OPTIONS}
                placeholder="Selecione"
              />
            </FormField>
            <FormField label="Alíquota de COFINS (%)">
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={form.defaultCofinsRate}
                onChange={(e) => setForm((f) => ({ ...f, defaultCofinsRate: e.target.value }))}
              />
            </FormField>
            <FormField label="Unidade padrão">
              <CodeSelect
                value={form.defaultUnit}
                onChange={(v) => setForm((f) => ({ ...f, defaultUnit: v }))}
                options={UNIT_OPTIONS}
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Revise os dados do emitente, endereço, emissão e tributação antes de salvar o cadastro fiscal completo.
          </p>
        </CardContent>
        <CardActions>
          <Button className="w-full sm:w-auto" onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending}>
            {saveProfile.isPending ? "Salvando..." : "Salvar cadastro fiscal"}
          </Button>
        </CardActions>
      </Card>

      <PendingProductsCard data={produtos} />
    </div>
  );
}

function StatusCard({
  environment,
  pendencias,
  canEmit,
}: {
  environment: FiscalEnvironment;
  pendencias: string[];
  canEmit: boolean;
}) {
  const producao = environment === FiscalEnvironment.PRODUCAO;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Situação</p>
          <p className="mt-1 text-lg font-black text-slate-900 dark:text-slate-50">
            {canEmit ? "Pronto para emitir em produção" : producao ? "Produção com pendências" : "Homologação"}
          </p>
          {!producao && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Documentos emitidos em homologação não têm valor fiscal.
            </p>
          )}
        </div>
        <span
          className={
            canEmit
              ? "inline-flex h-fit items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              : "inline-flex h-fit items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
          }
        >
          {canEmit ? "Tudo certo" : `${pendencias.length} pendência(s)`}
        </span>
      </CardContent>
      {pendencias.length > 0 && (
        <CardContent className="border-t border-slate-100 pt-4 dark:border-slate-800">
          <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            {pendencias.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden className="text-amber-500">•</span>
                {item}
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

/**
 * Produtos que ainda não podem sair numa nota.
 *
 * A pendência de um item é invisível até a venda acontecer. Esta lista existe
 * para o lojista conferir o cardápio inteiro antes de ligar a emissão, em vez
 * de descobrir item a item no balcão.
 */
function PendingProductsCard({ data }: { data?: ProductTaxStatusResponse }) {
  if (!data) return null;
  if (data.pending === 0) {
    return (
      <Card>
        <CardContent className="py-5 text-sm text-slate-600 dark:text-slate-300">
          Todos os {data.total} produtos ativos estão com a tributação completa.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{data.pending} produto(s) sem tributação completa</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Preencher os padrões acima resolve a maioria de uma vez. O que sobrar é ajustado em
          Cardápio, no cadastro de cada item.
        </p>
        <ul className="space-y-2">
          {data.items.slice(0, 20).map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
            >
              <p className="font-bold text-slate-800 dark:text-slate-200">{item.name}</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {item.pendencias.join(" ")}
              </p>
            </li>
          ))}
        </ul>
        {data.items.length > 20 && (
          <p className="text-xs text-slate-400">
            e mais {data.items.length - 20} produto(s).
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function CodeSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ code: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.code} value={option.code}>{option.label}</option>
      ))}
    </Select>
  );
}

function ExpiryBadge({ days }: { days: number }) {
  if (days <= 0) return <strong className="text-rose-600 dark:text-rose-400">vencido</strong>;
  if (days <= 30) return <strong className="text-amber-600 dark:text-amber-400">vence em {days} dia(s)</strong>;
  return <span className="text-slate-500 dark:text-slate-400">{days} dias restantes</span>;
}
