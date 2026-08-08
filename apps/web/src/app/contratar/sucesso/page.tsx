"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";

export default function SuccessPage(){
  useEffect(()=>localStorage.removeItem("chegowia:pending-checkout"),[]);
  return <main className="grid min-h-screen place-items-center bg-slate-950 p-5"><div className="w-full max-w-lg rounded-[34px] bg-white p-8 text-center shadow-2xl dark:bg-slate-900"><BrandLogo adaptive className="mx-auto h-12 w-52"/><div className="mx-auto mt-8 grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-3xl text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">✓</div><h1 className="mt-5 text-3xl font-black">Pagamento confirmado</h1><p className="mt-3 leading-7 text-slate-500 dark:text-slate-400">O Stripe está finalizando a confirmação. Assim que o webhook for processado, sua assinatura será ativada e todos os recursos da empresa serão liberados. O consumo feito no teste gratuito permanece coberto pela ChegowIA.</p><Link href="/acesso"><Button className="mt-7 w-full">Acessar minha conta</Button></Link></div></main>
}
