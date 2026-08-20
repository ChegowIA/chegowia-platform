"use client";

import { useEffect } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { reportClientError } from "@/lib/report-client-error";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    reportClientError(error, { digest: error.digest });
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-950 p-5">
      <section className="w-full max-w-md rounded-[30px] bg-white p-7 text-center shadow-2xl dark:bg-slate-900">
        <BrandLogo adaptive className="mx-auto h-11 w-48" />
        <div className="mx-auto mt-7 grid h-14 w-14 place-items-center rounded-2xl bg-rose-100 text-2xl font-black text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          !
        </div>
        <h1 className="mt-5 text-2xl font-black text-slate-950 dark:text-slate-100">Não foi possível abrir esta área</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
          Ocorreu um erro inesperado. Tente carregar o conteúdo novamente.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 min-h-12 w-full rounded-xl bg-brand-600 px-4 text-sm font-black text-white transition hover:bg-brand-700"
        >
          Tentar novamente
        </button>
      </section>
    </main>
  );
}
