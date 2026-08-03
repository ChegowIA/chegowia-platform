"use client";

import { useState } from "react";
import Link from "next/link";
import { api, apiErrorMessage } from "@/lib/api-client";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post("/auth/forgot-password", { email });
      setMessage(data.message);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f6f2ec] dark:bg-[#080d18] p-5">
      <section className="w-full max-w-md rounded-[30px] border border-white bg-white p-7 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <Link href="/acesso"><BrandLogo adaptive className="h-11 w-48" /></Link>
        <p className="mt-8 text-xs font-black uppercase tracking-[.18em] text-brand-700 dark:text-brand-300">Recupere seu acesso</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950 dark:text-slate-100">Esqueceu a senha?</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">Informe seu e-mail. Se ele estiver cadastrado, enviaremos um link seguro.</p>
        {message ? (
          <div className="mt-6 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">{message}</div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={submit}>
            <FormField label="E-mail"><Input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></FormField>
            {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
            <Button type="submit" className="w-full" isLoading={loading}>Enviar instruções</Button>
          </form>
        )}
        <Link className="mt-5 block text-center text-sm font-bold text-brand-700 hover:underline dark:text-brand-300" href="/acesso">Voltar para entrar</Link>
      </section>
    </main>
  );
}
