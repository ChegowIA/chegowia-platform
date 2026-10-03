"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, apiErrorMessage } from "@/lib/api-client";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";

export default function VerifyEmailPage() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Confirmando seu e-mail...");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setStatus("error");
      setMessage("O link de confirmação está incompleto.");
      return;
    }
    api.post("/auth/verify-email", { token })
      .then(() => {
        setStatus("success");
        setMessage("E-mail confirmado. Entre com sua senha para receber o código de acesso.");
        window.setTimeout(() => window.location.replace("/acesso"), 1_200);
      })
      .catch((error) => {
        setStatus("error");
        setMessage(apiErrorMessage(error, "Este link é inválido ou expirou."));
      });
  }, []);

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-950 p-5">
      <section className="w-full max-w-md rounded-[30px] bg-white p-7 text-center shadow-2xl dark:bg-slate-900">
        <BrandLogo adaptive className="mx-auto h-11 w-48" />
        <div className={`mx-auto mt-7 grid h-14 w-14 place-items-center rounded-2xl text-2xl font-black ${
          status === "error" ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
        }`}>{status === "loading" ? "…" : status === "success" ? "✓" : "!"}</div>
        <h1 className="mt-5 text-2xl font-black text-slate-950 dark:text-slate-100">
          {status === "success" ? "Tudo certo" : status === "error" ? "Não foi possível confirmar" : "Só um instante"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">{message}</p>
        {status !== "loading" && (
          <Link href="/acesso"><Button className="mt-6 w-full">Voltar para o acesso</Button></Link>
        )}
      </section>
    </main>
  );
}
