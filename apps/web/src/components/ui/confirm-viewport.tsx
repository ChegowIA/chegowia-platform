"use client";

import { useEffect, useRef, useState } from "react";
import { answerConfirm, ConfirmIcon, ConfirmRequest, ConfirmTone, subscribeToConfirm } from "@/lib/confirm";

/** Duração da saída; precisa bater com `confirm-card-out` no globals.css. */
const SAIDA_MS = 180;

const TONES: Record<ConfirmTone, { orb: string; ring: string; glow: string; bar: string; chip: string; accept: string }> = {
  danger: {
    orb: "from-rose-500 to-red-600 shadow-[0_18px_40px_-14px_rgba(220,38,38,.75)]",
    ring: "border-red-400/60",
    glow: "bg-red-500/25 dark:bg-red-500/20",
    bar: "from-rose-500 via-red-500 to-orange-400",
    chip: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200",
    accept: "bg-red-600 text-white shadow-[0_12px_28px_-14px_rgba(220,38,38,.9)] hover:bg-red-700 focus-visible:ring-red-500/40",
  },
  warning: {
    orb: "from-amber-400 to-orange-500 shadow-[0_18px_40px_-14px_rgba(245,158,11,.75)]",
    ring: "border-amber-400/60",
    glow: "bg-amber-400/25 dark:bg-amber-400/15",
    bar: "from-amber-400 via-orange-500 to-brand-500",
    chip: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
    accept: "bg-amber-500 text-amber-950 shadow-[0_12px_28px_-14px_rgba(245,158,11,.9)] hover:bg-amber-400 focus-visible:ring-amber-500/40",
  },
  default: {
    orb: "from-brand-500 to-brand-700 shadow-[0_18px_40px_-14px_rgba(234,88,12,.75)]",
    ring: "border-brand-400/60",
    glow: "bg-brand-500/25 dark:bg-brand-500/20",
    bar: "from-brand-400 via-brand-600 to-accent-500",
    chip: "border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-900/60 dark:bg-brand-950/40 dark:text-brand-200",
    accept: "bg-brand-600 text-white shadow-[0_12px_28px_-14px_rgba(234,88,12,.9)] hover:bg-brand-700 focus-visible:ring-brand-500/40",
  },
};

function Icone({ icon }: { icon: ConfirmIcon }) {
  const comum = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (icon === "trash") {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true" {...comum}>
        {/* A tampa abre quando o cursor chega no botão de apagar. */}
        <g className="confirm-lid"><path d="M3 6h18" /><path d="M9 6V4h6v2" /></g>
        <path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5M14 11v5" />
      </svg>
    );
  }
  if (icon === "stop") {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true" {...comum}>
        <circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" />
      </svg>
    );
  }
  if (icon === "alert") {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true" {...comum}>
        <path d="M12 3l9.5 17h-19L12 3z" /><path d="M12 10v4M12 17.5v.01" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true" {...comum}>
      <circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.8 2.8L16 10" />
    </svg>
  );
}

/**
 * Balão de confirmação global, aberto por `confirmar()`.
 *
 * Em ação destrutiva o foco começa em "Voltar": um Enter apressado não pode
 * apagar nada. Esc e clique fora sempre recusam.
 */
export function ConfirmViewport() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [saindo, setSaindo] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const focoAnterior = useRef<HTMLElement | null>(null);

  // Pedido aberto agora na fila; a animação de saída só desmonta se nenhum
  // outro pedido chegou enquanto ela rodava.
  const aberto = useRef<number | null>(null);

  useEffect(() => subscribeToConfirm((next) => {
    if (next) {
      aberto.current = next.id;
      setSaindo(false);
      setRequest(next);
      return;
    }
    aberto.current = null;
    setSaindo(true);
    window.setTimeout(() => {
      if (aberto.current !== null) return;
      setRequest(null);
      setSaindo(false);
    }, SAIDA_MS);
  }), []);

  useEffect(() => {
    if (!request || saindo) return;
    focoAnterior.current = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const alvo = request.tone === "danger" ? cancelRef.current : acceptRef.current;
    window.requestAnimationFrame(() => alvo?.focus());

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        answerConfirm(false);
        return;
      }
      // Mantém o Tab entre os dois botões enquanto o balão está aberto.
      if (event.key === "Tab") {
        event.preventDefault();
        const proximo = document.activeElement === cancelRef.current ? acceptRef.current : cancelRef.current;
        proximo?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      focoAnterior.current?.focus?.();
    };
  }, [request, saindo]);

  if (!request) return null;
  const tom = TONES[request.tone];

  return (
    <div
      className={`fixed inset-0 z-[10040] flex items-end justify-center bg-slate-950/55 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur-[6px] sm:items-center sm:p-6 ${saindo ? "confirm-backdrop-out" : "confirm-backdrop-in"}`}
      onMouseDown={(event) => event.target === event.currentTarget && answerConfirm(false)}
    >
      <section
        key={request.id}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className={`confirm-card relative w-full max-w-md overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_40px_120px_-30px_rgba(2,6,23,.6)] dark:border-slate-700/80 dark:bg-slate-900 ${saindo ? "confirm-card-out" : "confirm-card-in"}`}
      >
        <div className={`h-1.5 w-full bg-gradient-to-r ${tom.bar} confirm-bar`} />
        <div className={`pointer-events-none absolute -top-16 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full blur-3xl ${tom.glow}`} />

        <div className="relative px-6 pb-6 pt-7 text-center sm:px-8">
          <div className="relative mx-auto grid h-16 w-16 place-items-center">
            <span className={`confirm-ring absolute inset-0 rounded-2xl border-2 ${tom.ring}`} />
            <span className={`confirm-ring confirm-ring-late absolute inset-0 rounded-2xl border-2 ${tom.ring}`} />
            <span className={`confirm-icon relative grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br text-white ${tom.orb}`}>
              <Icone icon={request.icon} />
            </span>
          </div>

          <p className="mt-5 text-[10px] font-black uppercase tracking-[.18em] text-brand-600 dark:text-brand-400">ChegowIA</p>
          <h2 id="confirm-title" className="mt-1 text-xl font-black tracking-tight text-slate-950 dark:text-slate-50">{request.title}</h2>
          {request.subject && (
            <p className={`mx-auto mt-3 inline-flex max-w-full items-center rounded-xl border px-3 py-1.5 text-sm font-bold ${tom.chip}`}>
              <span className="truncate">{request.subject}</span>
            </p>
          )}
          <p id="confirm-message" className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{request.message}</p>

          <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row">
            <button
              ref={cancelRef}
              type="button"
              onClick={() => answerConfirm(false)}
              className="group inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-400/30 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            >
              {request.cancelLabel}
              <kbd className="hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 sm:inline dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400">Esc</kbd>
            </button>
            <button
              ref={acceptRef}
              type="button"
              onClick={() => answerConfirm(true)}
              className={`confirm-accept relative inline-flex min-h-12 flex-1 items-center justify-center overflow-hidden rounded-2xl px-4 text-sm font-black transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-4 ${tom.accept}`}
            >
              <span className="confirm-shine pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 skew-x-[-20deg] bg-white/30" />
              <span className="relative">{request.confirmLabel}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
