import Image from "next/image";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  variant?: "login" | "register";
}) {
  return (
    <main className="relative min-h-dvh overflow-x-hidden bg-[#f4f1ec] dark:bg-[#080d18] xl:h-dvh xl:overflow-hidden xl:p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgba(255,153,80,.2),transparent_25%),radial-gradient(circle_at_10%_90%,rgba(34,211,238,.1),transparent_24%)]" />

      <div className="relative mx-auto grid min-h-dvh max-w-[1500px] xl:h-[calc(100dvh-2rem)] xl:min-h-0 xl:grid-cols-[minmax(460px,.9fr)_minmax(600px,1.1fr)] xl:gap-4">
        <aside className="relative hidden overflow-hidden rounded-[34px] bg-[#07101f] p-9 text-white xl:flex xl:min-h-0 xl:flex-col">
          <div className="absolute -left-20 top-1/3 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="absolute -right-12 top-16 h-64 w-64 rounded-full bg-orange-500/20 blur-3xl" />

          <div className="relative flex items-center justify-between">
            <Link href="/" className="inline-flex" aria-label="ChegowIA — início">
              <BrandLogo light className="h-8 w-40" />
            </Link>
            <span className="rounded-full border border-white/15 bg-white/[.07] px-3 py-1.5 text-[10px] font-black uppercase tracking-[.17em] text-white/60">
              Acesso do cliente
            </span>
          </div>

          <div className="relative mt-10 max-w-xl">
            <p className="text-xs font-black uppercase tracking-[.22em] text-orange-300">Da vontade à primeira mordida</p>
            <h2 className="mt-4 text-[clamp(2.7rem,3.4vw,4rem)] font-black leading-[.96] tracking-[-.055em]">
              O que você gosta, mais perto do que imagina.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-slate-300">
              Descubra lugares da sua região, escolha sem pressa e acompanhe cada etapa do pedido.
            </p>
          </div>

          <div className="auth-journey relative mt-8 max-w-xl rounded-[24px] border border-white/10 bg-white/[.055] px-5 py-4 backdrop-blur-sm">
            <div className="relative grid grid-cols-3">
              <span className="absolute left-[16.66%] right-[16.66%] top-5 h-px overflow-hidden bg-white/15">
                <span className="auth-journey-line block h-full w-full origin-left bg-gradient-to-r from-orange-400 via-amber-300 to-emerald-300" />
              </span>
              <span className="auth-journey-runner absolute left-[16.66%] top-[17px] z-20 h-2 w-2 -translate-x-1/2 rounded-full bg-white shadow-[0_0_14px_5px_rgba(251,146,60,.5)] dark:bg-slate-900" />

              {[
                { label: "Encontre", detail: "perto de você", color: "bg-orange-500", icon: <path key="pin" d="M12 20s5.5-4.2 5.5-9.6a5.5 5.5 0 1 0-11 0C6.5 15.8 12 20 12 20Zm0-7.5a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" stroke="currentColor" strokeWidth="1.6" /> },
                { label: "Escolha", detail: "do seu jeito", color: "bg-amber-400", icon: <path key="bag" d="M7 9h10l1 10H6L7 9Zm2 1V7a3 3 0 0 1 6 0v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /> },
                { label: "Receba", detail: "e acompanhe", color: "bg-emerald-300", icon: <path key="check" d="m7 12 3.2 3.2L17 8.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /> },
              ].map((item, index) => (
                <div key={item.label} className={`auth-journey-step relative z-10 text-center auth-journey-step-${index + 1}`}>
                  <span className={`mx-auto grid h-10 w-10 place-items-center rounded-full border-4 border-[#111a29] ${item.color} text-white shadow-lg`}>
                    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">{item.icon}</svg>
                  </span>
                  <strong className="mt-2.5 block text-xs font-black text-white">{item.label}</strong>
                  <span className="mt-0.5 block text-[10px] font-semibold text-slate-500 dark:text-slate-400">{item.detail}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative mt-auto overflow-hidden rounded-[28px] border border-white/10 bg-white/[.06] p-2 shadow-2xl">
            <div className="relative h-[clamp(210px,29vh,290px)] overflow-hidden rounded-[22px]">
              <Image
                src="/landing/restaurant-operation-hero.png"
                alt="Restaurante local preparando pedidos"
                fill
                priority
                sizes="(min-width: 1280px) 42vw, 0px"
                className="object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent" />
              <div className="absolute inset-x-4 bottom-4 flex items-center justify-between gap-3 rounded-2xl bg-white/95 p-3.5 text-slate-950 shadow-xl backdrop-blur dark:bg-slate-900/95 dark:text-slate-100">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-500 text-white">
                    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true"><path d="M12 21s7-5.2 7-12a7 7 0 1 0-14 0c0 6.8 7 12 7 12Z" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="9" r="2.4" stroke="currentColor" strokeWidth="1.8"/></svg>
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-sm">Escolhas da sua região</strong>
                    <small className="block truncate text-xs text-slate-500 dark:text-slate-400">Lojas que realmente chegam até você</small>
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Perto</span>
              </div>
            </div>
          </div>
        </aside>

        <section className="flex min-h-dvh flex-col xl:h-full xl:min-h-0">
          <header className="flex h-[82px] shrink-0 items-center justify-between border-b border-slate-200/70 bg-white/75 dark:border-slate-800/70 dark:bg-slate-900/75 px-5 backdrop-blur-md sm:px-8 xl:hidden">
            <Link href="/" className="inline-flex" aria-label="ChegowIA — início">
              <BrandLogo adaptive className="h-9 w-44" />
            </Link>
            <div className="flex items-center gap-3"><ThemeToggle /><Link href="/" className="text-xs font-extrabold text-slate-500 hover:text-slate-900 dark:text-slate-400">Voltar ao início</Link></div>
          </header>

          <div className="flex flex-1 items-start justify-center px-0 sm:items-center sm:px-6 sm:py-8 xl:min-h-0 xl:px-10 xl:py-5">
            <div className="auth-card w-full bg-white px-5 py-7 shadow-[0_30px_90px_rgba(15,23,42,.1)] sm:max-w-[680px] sm:rounded-[30px] sm:border sm:border-white sm:px-9 sm:py-8 xl:max-h-[calc(100dvh-4rem)] xl:overflow-hidden xl:px-10 dark:bg-slate-900">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[.2em] text-orange-600 dark:text-orange-400">{eyebrow}</p>
                  <h1 className="mt-2 text-[2rem] font-black leading-tight tracking-[-.04em] text-slate-950 sm:text-4xl dark:text-slate-100">{title}</h1>
                  <p className="mt-2 max-w-xl leading-6 text-slate-500 dark:text-slate-400">{description}</p>
                </div>
                <span className="hidden h-11 w-11 shrink-0 place-items-center rounded-2xl bg-orange-50 text-orange-600 sm:grid dark:bg-orange-950/30 dark:text-orange-400" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5"><path d="M8 10V8a4 4 0 1 1 8 0v2m-9 0h10a2 2 0 0 1 2 2v7H5v-7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                </span>
              </div>

              {children}
            </div>
          </div>

          <p className="hidden pb-4 text-center text-[11px] font-semibold text-slate-400 sm:block xl:hidden">
            ChegowIA · Delivery local, sem complicação.
          </p>
        </section>
      </div>
    </main>
  );
}
