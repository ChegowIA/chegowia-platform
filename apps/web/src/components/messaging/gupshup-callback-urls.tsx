"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

type GupshupConfig = {
  enabled: boolean;
  callbackUrls: { meta: string; gupshup: string } | null;
};

/**
 * URLs de callback para colar no painel do Gupshup.
 *
 * São duas porque o Gupshup deixa escolher o formato do payload por webhook, e
 * cada formato cai num parser diferente. Apontar "Formato Meta (v3)" para a
 * porta que espera o formato nativo faz a mensagem chegar e ser descartada em
 * silêncio — nada aparece na central e nada aparece como erro. Mostrar as duas
 * lado a lado, com o formato exigido, é o que evita esse engano.
 */
export function GupshupCallbackUrls() {
  const { data } = useQuery({
    queryKey: ["whatsapp-gupshup-config"],
    queryFn: async () => (await api.get<GupshupConfig>("/messaging/channel/whatsapp/gupshup")).data,
  });

  if (!data?.enabled || !data.callbackUrls) return null;

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          URL de callback
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          No painel do Gupshup, aba <strong>Webhooks</strong> do aplicativo. Escolha a URL de acordo com o
          <strong> Formato de carga útil</strong> selecionado lá — se não casar, a mensagem chega e é
          descartada sem erro.
        </p>
      </div>

      <Row
        label="Se o formato for “Meta (v3)”"
        url={data.callbackUrls.meta}
        recommended
      />
      <Row label="Se o formato for o nativo do Gupshup" url={data.callbackUrls.gupshup} />
    </div>
  );
}

function Row({ label, url, recommended }: { label: string; url: string; recommended?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950">
      <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
        {label}
        {recommended && (
          <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
            recomendado
          </span>
        )}
      </p>
      <code className="mt-1 block break-all text-xs text-slate-500 dark:text-slate-400">{url}</code>
    </div>
  );
}
