"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, apiErrorMessage } from "@/lib/api-client";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("As senhas precisam ser iguais.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.post("/auth/reset-password", { token, password, confirmPassword });
      setDone(true);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-950 p-5">
      <section className="w-full max-w-md rounded-[30px] bg-white p-7 shadow-2xl dark:bg-slate-900">
        <BrandLogo adaptive className="h-11 w-48" />
        <h1 className="mt-8 text-3xl font-black text-slate-950 dark:text-slate-100">Crie uma nova senha</h1>
        {done ? (
          <div className="mt-6">
            <p className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">Senha alterada e sessões antigas encerradas.</p>
            <Link href="/acesso"><Button className="mt-5 w-full">Entrar com a nova senha</Button></Link>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={submit}>
            <FormField label="Nova senha"><Input type="password" autoComplete="new-password" minLength={8} pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9\\s]).{8,}" required value={password} onChange={(event) => setPassword(event.target.value)} /><p className="text-xs text-slate-400">8 caracteres ou mais, com maiúscula, minúscula e símbolo.</p></FormField>
            <FormField label="Confirme a nova senha"><Input type="password" autoComplete="new-password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></FormField>
            {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
            <Button type="submit" className="w-full" isLoading={loading} disabled={!token || password !== confirmPassword}>Salvar nova senha</Button>
          </form>
        )}
      </section>
    </main>
  );
}
