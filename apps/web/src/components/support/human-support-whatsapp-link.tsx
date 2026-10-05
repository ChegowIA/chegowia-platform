import { CHEGOWIA_HUMAN_SUPPORT_WHATSAPP_NUMBER, CHEGOWIA_HUMAN_SUPPORT_WHATSAPP_URL } from "@chegowia/shared";
import clsx from "clsx";

export function HumanSupportWhatsAppLink({ className }: { className?: string }) {
  return (
    <a
      href={CHEGOWIA_HUMAN_SUPPORT_WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx(
        "flex min-h-12 items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-emerald-950 transition hover:border-emerald-500 hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-100 dark:hover:bg-emerald-900/70",
        className,
      )}
      aria-label={`Abrir WhatsApp de atendimento humano da ChegowIA: ${CHEGOWIA_HUMAN_SUPPORT_WHATSAPP_NUMBER}`}
    >
      <span className="min-w-0">
        <span className="block text-xs font-black">Atendimento humano e suporte avançado</span>
        <span className="block text-xs font-semibold">WhatsApp {CHEGOWIA_HUMAN_SUPPORT_WHATSAPP_NUMBER}</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-lg font-black">↗</span>
    </a>
  );
}
