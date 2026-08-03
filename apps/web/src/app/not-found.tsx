import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";

export default function NotFoundPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-950 p-5">
      <section className="w-full max-w-md rounded-[30px] bg-white p-7 text-center shadow-2xl dark:bg-slate-900">
        <BrandLogo adaptive className="mx-auto h-11 w-48" />
        <div className="mx-auto mt-7 grid h-16 w-16 place-items-center rounded-2xl bg-brand-50 text-xl font-black text-brand-700 dark:bg-brand-950/30 dark:text-brand-300">
          404
        </div>
        <h1 className="mt-5 text-2xl font-black text-slate-950 dark:text-slate-100">Página não encontrada</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
          O endereço acessado não existe ou foi alterado.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand-600 px-4 text-sm font-black text-white transition hover:bg-brand-700"
        >
          Voltar ao início
        </Link>
      </section>
    </main>
  );
}
