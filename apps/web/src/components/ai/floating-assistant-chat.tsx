"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import gsap from "gsap";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/brand/brand-logo";

export function FloatingAssistantChat({
  title,
  subtitle,
  children,
  defaultOpen = false,
  triggerEyebrow = "Posso ajudar?",
  triggerLabel = "Fale com a loja",
  triggerKind = "assistant",
  position = "right",
  stacked = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  triggerEyebrow?: string;
  triggerLabel?: string;
  /** Diferencia visualmente canais globais, como o suporte da plataforma. */
  triggerKind?: "assistant" | "support";
  /** Permite um segundo canal global, como o suporte, sem sobrepor o assistente operacional. */
  position?: "left" | "right";
  /** Posiciona este atalho acima de outro balão na mesma lateral. */
  stacked?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const panelId = useId();
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const triggerTextRef = useRef<HTMLSpanElement | null>(null);
  const hasMobileDock = Boolean(pathname?.startsWith("/painel") || pathname?.startsWith("/super-admin") || pathname?.startsWith("/revendedor"));
  const isSupportTrigger = triggerKind === "support";
  const expanded = !open && (hovered || focused);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * O estado inicial é propositalmente só o selo circular. O GSAP controla
   * exclusivamente a largura e a entrada do texto, evitando o "pulo" que um
   * transition-all causa quando os dois atalhos empilhados mudam de tamanho.
   * Em preferências de movimento reduzido, a mudança é imediata e acessível.
   */
  useEffect(() => {
    const trigger = triggerRef.current;
    const text = triggerTextRef.current;
    if (!trigger || !text) return;

    const width = expanded ? Math.min(248, window.innerWidth - 24) : 56;
    const textState = { autoAlpha: expanded ? 1 : 0, x: expanded ? 0 : -8 };
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    gsap.killTweensOf(trigger);
    gsap.killTweensOf(text);

    if (reduceMotion) {
      gsap.set(trigger, { width });
      gsap.set(text, textState);
      return;
    }

    gsap.to(trigger, {
      width,
      duration: 0.32,
      ease: "power3.out",
      overwrite: "auto",
    });
    gsap.to(text, {
      ...textState,
      duration: 0.22,
      delay: expanded ? 0.07 : 0,
      ease: "power2.out",
      overwrite: "auto",
    });
  }, [expanded]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-floating-trigger={triggerKind}
        aria-label={open ? "Fechar assistente" : isSupportTrigger ? "Abrir suporte ChegowIA" : `Abrir assistente: ${triggerLabel}`}
        aria-expanded={open}
        aria-controls={panelId}
        // O atalho só abre o canal. O fechamento fica explícito no painel,
        // evitando que um segundo toque (comum no mobile) pareça ignorar a
        // abertura ou feche a conversa imediatamente.
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={() => {
          setHovered(false);
          setFocused(false);
          setOpen(true);
        }}
        className={clsx(
          // Fechado, o botão é apenas o disco de ícone. O capsule só aparece
          // quando há intenção clara (hover/foco), preservando espaço visual
          // e não disputando atenção com a operação do cliente.
          "group fixed z-[110] flex h-14 w-14 max-w-[calc(100vw-1.5rem)] cursor-pointer items-center overflow-hidden rounded-full shadow-[0_18px_50px_-12px_rgba(15,23,42,.35)] outline-none transition-[background-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-1 active:translate-y-0 active:scale-95 focus-visible:ring-4 focus-visible:ring-brand-400/35",
          position === "left" ? "left-3 md:left-5" : "right-3 md:right-5",
          expanded
            ? "bg-brand-600 text-white shadow-[0_18px_50px_-12px_rgba(234,88,12,.65)] dark:bg-brand-500"
            : isSupportTrigger
              ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200/90 dark:bg-brand-400/15 dark:text-brand-200 dark:ring-brand-300/25"
              : "bg-white text-slate-950 ring-1 ring-slate-200/90 dark:bg-slate-900 dark:text-white dark:ring-white/15 dark:shadow-[0_18px_50px_-12px_rgba(0,0,0,.8)]",
          stacked
            ? hasMobileDock
              ? "bottom-[calc(9.65rem+env(safe-area-inset-bottom))] md:bottom-[5.5rem]"
              : "bottom-[max(5rem,calc(4.25rem+env(safe-area-inset-bottom)))] md:bottom-[5.5rem]"
            : hasMobileDock
              ? "bottom-[calc(5.4rem+env(safe-area-inset-bottom))] md:bottom-5"
              : "bottom-[max(.75rem,env(safe-area-inset-bottom))] md:bottom-5",
          open && "pointer-events-none translate-y-20 opacity-0",
        )}
      >
        <span className="relative grid h-14 w-14 shrink-0 place-items-center">
          <span className={clsx(
            "absolute inset-1.5 rounded-full transition-colors duration-200",
            // O logo da marca é alaranjado: no estado expandido ele precisa de
            // uma base branca real para nunca se perder dentro da cápsula.
            expanded ? "bg-white shadow-sm" : isSupportTrigger ? "bg-brand-100 dark:bg-slate-800" : "bg-white",
          )} />
          <span className={clsx("relative grid h-10 w-10 place-items-center", isSupportTrigger && "text-brand-700 dark:text-brand-300")}>
            {isSupportTrigger ? <SupportIcon /> : <BrandLogo adaptive variant="mark" className="h-8 w-8" />}
          </span>
          <span className={clsx(
            "absolute right-1.5 top-1.5 h-3 w-3 rounded-full border-2 bg-emerald-400 transition-colors",
            expanded ? "border-brand-600 dark:border-brand-500" : isSupportTrigger ? "border-brand-50 dark:border-slate-900" : "border-white dark:border-slate-900",
          )} />
        </span>
        <span ref={triggerTextRef} className="pointer-events-none min-w-0 flex-1 pr-4 text-left opacity-0 invisible" aria-hidden={!expanded}>
          <span className="block truncate text-[10px] font-bold uppercase tracking-[0.16em] text-brand-100">{triggerEyebrow}</span>
          <span className="block truncate text-sm font-bold leading-tight">{triggerLabel}</span>
        </span>
      </button>

      <div
        id={panelId}
        className={clsx(
          // A central precisa ficar acima do dock móvel (z-80) e de qualquer
          // shell do painel. Sem isso, o clique abria o chat por trás da
          // interface e dava a impressão de que o botão não fazia nada.
          "fixed inset-0 z-[100] flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-white shadow-2xl transition-all duration-300 ease-out dark:bg-slate-900",
          "sm:inset-auto sm:bottom-6 sm:h-[min(640px,calc(100vh-3rem))] sm:w-[400px] sm:max-w-[calc(100vw-3rem)] sm:rounded-3xl sm:border sm:border-slate-200/80",
          position === "left" ? "sm:left-6" : "sm:right-6",
          "dark:sm:border-white/15",
          open ? "pointer-events-auto opacity-100 sm:translate-y-0 sm:scale-100" : "pointer-events-none opacity-0 sm:translate-y-6 sm:scale-95",
        )}
        aria-hidden={!open}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 bg-slate-950 px-5 py-4 text-white">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white dark:bg-slate-900">
              <BrandLogo adaptive variant="mark" className="h-8 w-8" />
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-slate-950 bg-emerald-400" />
            </span>
            <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-300">Atendimento online</p>
            <h2 className="mt-0.5 line-clamp-1 text-lg font-black text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 line-clamp-1 text-xs text-slate-300">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            aria-label="Fechar assistente"
            onClick={() => setOpen(false)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            <CloseIcon />
          </button>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </>
  );
}

function SupportIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7" aria-hidden="true">
      <path d="M4.5 13.25v-1.5a7.5 7.5 0 0 1 15 0v1.5" />
      <path d="M5 13.25h1.75A1.25 1.25 0 0 1 8 14.5v2A1.25 1.25 0 0 1 6.75 17.75H5A1.5 1.5 0 0 1 3.5 16.25v-1.5A1.5 1.5 0 0 1 5 13.25Z" />
      <path d="M19 13.25h-1.75A1.25 1.25 0 0 0 16 14.5v2a1.25 1.25 0 0 0 1.25 1.25H19a1.5 1.5 0 0 0 1.5-1.5v-1.5a1.5 1.5 0 0 0-1.5-1.5Z" />
      <path d="M16 19.25c-.9.8-2.2 1.25-4 1.25" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
