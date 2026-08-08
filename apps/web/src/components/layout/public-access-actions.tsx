import Link from "next/link";
import clsx from "clsx";

type AccessTone = "adaptive" | "dark";

type AccountAccessLinkProps = {
  tone?: AccessTone;
  className?: string;
  forceLabel?: boolean;
};

type PublicAccessActionsProps = {
  tone?: AccessTone;
  className?: string;
  showBusinessLink?: boolean;
  showSignup?: boolean;
  signupHref?: string;
  signupLabel?: string;
};

const adaptiveOutline = "border-slate-200 bg-white/90 text-slate-700 shadow-sm hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-200 dark:hover:border-brand-800 dark:hover:bg-brand-950/40 dark:hover:text-brand-200";
const darkOutline = "border-white/15 bg-white/[.04] text-slate-100 hover:border-brand-300/50 hover:bg-white/10 hover:text-white";
const actionControl = "inline-flex h-10 min-h-10 shrink-0 items-center justify-center rounded-xl";

export function AccountAccessLink({ tone = "adaptive", className, forceLabel = false }: AccountAccessLinkProps) {
  return (
    <Link
      href="/acesso"
      aria-label="Acessar minha conta"
      className={clsx(
        actionControl,
        "gap-2 border px-3 text-sm font-black transition",
        tone === "dark" ? darkOutline : adaptiveOutline,
        forceLabel ? "" : "w-10 px-0 min-[480px]:w-auto min-[480px]:px-3",
        className,
      )}
    >
      <AccessIcon />
      <span className={forceLabel ? "" : "hidden min-[480px]:inline"}>Acessar conta</span>
    </Link>
  );
}

export function PublicAccessActions({
  tone = "adaptive",
  className,
  showBusinessLink = true,
  showSignup = true,
  signupHref = "/cadastro",
  signupLabel = "Criar conta",
}: PublicAccessActionsProps) {
  return (
    <div className={clsx("flex shrink-0 items-center gap-1.5 sm:gap-2", className)}>
      {showBusinessLink && (
        <Link
          href="/software"
          className={clsx(
            "hidden h-10 items-center gap-2 rounded-xl px-3 text-sm font-bold transition lg:inline-flex",
            tone === "dark" ? "text-slate-300 hover:bg-white/10 hover:text-white" : "text-slate-600 hover:bg-brand-50 hover:text-brand-700 dark:text-slate-300 dark:hover:bg-brand-950/30 dark:hover:text-brand-200",
          )}
        >
          <BusinessIcon />
          <span>Soluções para empresas</span>
        </Link>
      )}

      <AccountAccessLink tone={tone} />

      {showSignup && (
        <Link
          href={signupHref}
          className={clsx(
            actionControl,
            "gap-1.5 border border-transparent bg-brand-600 px-3 text-sm font-black text-white shadow-sm transition hover:-translate-y-px hover:bg-brand-700 hover:shadow-md active:translate-y-0 min-[390px]:px-3.5",
          )}
        >
          <span className="min-[390px]:hidden">Criar</span>
          <span className="hidden min-[390px]:inline">{signupLabel}</span>
          <span aria-hidden className="hidden text-base leading-none min-[460px]:inline">→</span>
        </Link>
      )}
    </div>
  );
}

function AccessIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] shrink-0" aria-hidden="true">
      <path d="M13 5h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4" />
      <path d="m10 16 4-4-4-4" />
      <path d="M14 12H3" />
    </svg>
  );
}

function BusinessIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]" aria-hidden="true">
      <path d="M4 21V7a2 2 0 0 1 2-2h5v16" />
      <path d="M15 21V3h3a2 2 0 0 1 2 2v16" />
      <path d="M8 9h3M8 13h3M18 8h.01M18 12h.01" />
    </svg>
  );
}
