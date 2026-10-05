"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import { FormField, Input, Textarea } from "@/components/ui/input";
import { BrazilStateSelect, MaskedInput } from "@/components/ui/brazil-fields";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { AccountAccessLink } from "@/components/layout/public-access-actions";
import {
  CHEGOWIA_HUMAN_SUPPORT_WHATSAPP_NUMBER,
  CHEGOWIA_HUMAN_SUPPORT_WHATSAPP_URL,
  CHEGOWIA_SALES_WHATSAPP_NUMBER,
} from "@chegowia/shared";

const CHEGOWIA_WHATSAPP_URL = "https://wa.me/556231425344?text=Ol%C3%A1%2C%20quero%20conhecer%20o%20ChegowIA%20e%20entender%20como%20ele%20pode%20ajudar%20minha%20opera%C3%A7%C3%A3o.";

const MODULES = [
  { icon: "▦", title: "Pedidos em fluxo", text: "Delivery e retirada em um quadro visual, com etapas claras, atualização em tempo real e detalhes em um clique.", color: "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300" },
  { icon: "🍽", title: "Mesas e salão", text: "Abra mesas, vincule clientes, acompanhe comandas e identifique atendimentos que precisam de atenção.", color: "bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300" },
  { icon: "◉", title: "Cozinha sincronizada", text: "A equipe recebe os pedidos na ordem certa e avança o preparo sem depender de papel ou recados soltos.", color: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300" },
  { icon: "↗", title: "Entrega acompanhada", text: "Atribua motoboys, acompanhe o fluxo da entrega e mantenha empresa e cliente informados.", color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" },
  { icon: "◎", title: "Clientes e relacionamento", text: "Histórico de consumo, contato facilitado e uma experiência de compra pensada para recorrência.", color: "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300" },
  { icon: "✦", title: "IA que executa junto", text: "Assistentes separados por função ajudam no atendimento, na operação e na leitura dos dados, sempre sob seu controle.", color: "bg-fuchsia-50 text-fuchsia-700" },
];

const FAQ = [
  ["O ChegowIA serve apenas para delivery?", "Não. A plataforma reúne delivery, retirada e atendimento no salão. Mesas, comandas e pedidos locais convivem com a operação de entrega no mesmo ambiente."],
  ["Preciso trocar toda a minha operação de uma vez?", "Não. A implantação pode começar pelo fluxo que mais gera atrito hoje e evoluir conforme a equipe ganha segurança. O objetivo é organizar, não interromper o trabalho."],
  ["A inteligência artificial toma decisões sozinha?", "A IA auxilia na leitura do contexto, no atendimento e em ações operacionais. Ações sensíveis continuam visíveis e controladas por pessoas responsáveis pela empresa."],
  ["Como funcionam usuários e permissões?", "Administrador, funcionários, cozinha e motoboys possuem acessos adequados ao trabalho de cada perfil. Assim, cada pessoa vê as ferramentas de que realmente precisa."],
  ["O cliente também acompanha o pedido?", "Sim. O cliente visualiza a evolução do pedido e da entrega em uma experiência própria, sem precisar acessar o painel interno da empresa."],
  ["Posso conversar com alguém antes de contratar?", "Sim. O WhatsApp comercial tira dúvidas com um assistente virtual. Se preferir atendimento humano, use o formulário no final da página ou o WhatsApp de atendimento indicado no rodapé."],
];

export default function SoftwareLanding() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: "", companyName: "", email: "", phone: "", city: "", state: "", message: "Quero entender como o ChegowIA pode organizar minha operação." });
  const send = useMutation({ mutationFn: () => api.post("/resellers/leads", form), onSuccess: () => setSent(true) });
  const { data: plans = [] } = useQuery({
    queryKey: ["software-plans"],
    queryFn: async () => (await api.get<Array<{ monthlyPrice: number | string }>>("/billing/plans")).data,
  });
  const monthlyPrice = Number(plans[0]?.monthlyPrice ?? 159.9);

  return (
    <main className="overflow-hidden bg-[#f8f8f6] dark:bg-[#080d18] text-slate-950 dark:text-slate-100">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-slate-950/90 text-white backdrop-blur-xl">
        <div className="mx-auto flex h-[74px] max-w-7xl items-center justify-between px-5">
          <Link href="/software" className="inline-flex h-[52px] items-center justify-center"><BrandLogo light className="h-8 w-36 sm:w-40" /></Link>
          <nav className="hidden items-center gap-7 text-sm font-bold text-slate-300 lg:flex">
            <a className="transition hover:text-white" href="#plataforma">Plataforma</a>
            <a className="transition hover:text-white" href="#operacao">Como funciona</a>
            <a className="transition hover:text-white" href="#inteligencia">Inteligência</a>
            <a className="transition hover:text-white" href="#preco">Plano</a>
            <a className="transition hover:text-white" href="#duvidas">Dúvidas</a>
          </nav>
          <div className="hidden items-center gap-2 lg:flex"><ThemeToggle tone="onDark" />
            <AccountAccessLink tone="dark" />
            <a href={CHEGOWIA_WHATSAPP_URL} target="_blank" rel="noreferrer"><Button className="rounded-xl !border-emerald-400/40 !bg-emerald-500/15 !text-emerald-50 hover:!bg-emerald-500/25 hover:!text-white">WhatsApp comercial</Button></a>
            <Link href="/planos"><Button className="rounded-xl">Começar agora</Button></Link>
          </div>
          <div className="flex items-center gap-2 lg:hidden">
            <ThemeToggle tone="onDark" />
            <button aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={mobileOpen} className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 text-xl transition hover:bg-white/10" onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? "×" : "☰"}</button>
          </div>
        </div>
        {mobileOpen && <nav className="border-t border-white/10 px-5 py-4 lg:hidden"><div className="mx-auto grid max-w-7xl gap-2 text-sm font-bold">{[["Plataforma", "#plataforma"], ["Como funciona", "#operacao"], ["Inteligência", "#inteligencia"], ["Plano", "#preco"], ["Falar com especialista", "#contato"]].map(([label, href]) => <a key={href} onClick={() => setMobileOpen(false)} className="rounded-xl px-3 py-2 text-slate-300 transition hover:bg-white/10 hover:text-white" href={href}>{label}</a>)}<div className="mt-2 grid grid-cols-2 gap-2 border-t border-white/10 pt-4"><AccountAccessLink tone="dark" forceLabel className="w-full" /><Link href="/planos" onClick={() => setMobileOpen(false)} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-3 text-sm font-black text-white transition hover:bg-brand-500">Ver planos <span aria-hidden>→</span></Link></div></div></nav>}
      </header>

      <section className="relative min-h-[820px] bg-slate-950 pt-[74px] text-white">
        <Image src="/landing/restaurant-operation-hero.png" alt="Equipe de restaurante gerenciando a operação com o ChegowIA" fill priority sizes="100vw" className="object-cover object-center opacity-55" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,6,23,.98)_0%,rgba(2,6,23,.9)_35%,rgba(2,6,23,.34)_72%,rgba(2,6,23,.28)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-slate-950 to-transparent" />
        <div className="relative mx-auto flex min-h-[746px] max-w-7xl items-center px-5 py-20">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[.14em] backdrop-blur"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />Operação conectada, de verdade</div>
            <h1 className="mt-7 text-5xl font-black leading-[.98] tracking-[-.055em] sm:text-6xl lg:text-7xl">Menos improviso.<br /><span className="text-brand-400">Mais ritmo</span> para vender.</h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-200 sm:text-xl">O ChegowIA conecta pedidos, mesas, cozinha, entregas, equipe e clientes em uma plataforma viva — com inteligência artificial útil e pessoas no controle.</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row"><Link href="/planos"><Button size="lg" className="h-14 rounded-2xl px-7 text-base font-black">Conhecer o ChegowIA <span aria-hidden>→</span></Button></Link><a href={CHEGOWIA_WHATSAPP_URL} target="_blank" rel="noreferrer"><Button size="lg" className="h-14 w-full rounded-2xl !border-emerald-400 !bg-emerald-500 px-7 text-base font-black !text-white shadow-[0_12px_28px_-14px_rgba(16,185,129,.9)] hover:!bg-emerald-400 sm:w-auto">Tirar dúvidas no WhatsApp</Button></a></div>
            <div className="mt-10 flex flex-wrap gap-x-7 gap-y-3 text-xs font-bold text-slate-300"><span>✓ Delivery e salão</span><span>✓ Gestão em tempo real</span><span>✓ Sem taxa por pedido</span><span>✓ Suporte e atualizações</span></div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800">
        <div className="mx-auto grid max-w-7xl divide-y divide-slate-200 px-5 py-6 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4 dark:divide-slate-800">
          <Proof value="Um só fluxo" label="Delivery, retirada e salão" />
          <Proof value="Tempo real" label="Da entrada à entrega" />
          <Proof value="Por perfil" label="Acesso certo para cada função" />
          <Proof value="Controle humano" label="IA como apoio, não como caixa-preta" />
        </div>
      </section>

      <section id="plataforma" className="mx-auto max-w-7xl px-5 py-24">
        <div className="max-w-3xl"><Eyebrow>Uma plataforma, a operação inteira</Eyebrow><h2 className="mt-4 text-4xl font-black tracking-[-.04em] sm:text-5xl">Tudo conversa. Sua equipe também.</h2><p className="mt-5 text-lg leading-8 text-slate-600 dark:text-slate-400">Em vez de alternar entre planilhas, mensagens e ferramentas desconectadas, cada etapa alimenta a próxima. O pedido nasce organizado e continua visível até o fechamento.</p></div>
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{MODULES.map((module) => <article key={module.title} className="group rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl dark:bg-slate-900 dark:border-slate-800"><span className={`grid h-12 w-12 place-items-center rounded-2xl text-xl font-black ${module.color}`}>{module.icon}</span><h3 className="mt-6 text-xl font-black">{module.title}</h3><p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-400">{module.text}</p><div className="mt-6 h-px bg-slate-100 transition group-hover:bg-brand-200 dark:bg-slate-800" /></article>)}</div>
      </section>

      <section id="operacao" className="bg-slate-950 py-24 text-white">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 lg:grid-cols-[.9fr_1.1fr]">
          <div className="relative">
            <div className="overflow-hidden rounded-[34px] border border-white/10 shadow-2xl"><Image src="/landing/restaurant-table-service-v2.png" alt="Gestora acompanhando mesas e cozinha em tempo real" width={1456} height={1092} sizes="(max-width: 1024px) 100vw, 48vw" className="h-auto w-full" /></div>
            <div className="absolute -bottom-6 -right-3 max-w-[260px] rounded-2xl border border-white/10 bg-white p-4 text-slate-950 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:shadow-black/40 sm:right-6"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">✓</span><div><p className="text-xs font-black uppercase text-emerald-700 dark:text-emerald-300">Operação online</p><p className="text-sm font-bold">Equipe na mesma direção</p></div></div></div>
          </div>
          <div><Eyebrow light>Da tela para a rotina</Eyebrow><h2 className="mt-4 text-4xl font-black tracking-[-.04em] sm:text-5xl">Cada pessoa sabe o que fazer agora.</h2><p className="mt-5 text-lg leading-8 text-slate-300">O ChegowIA organiza a passagem de responsabilidade. Quem atende registra, a cozinha prepara, a gestão acompanha e a entrega recebe o pedido certo — com menos ruído entre as pessoas.</p><ol className="mt-9 space-y-6">{[["01", "O pedido entra completo", "Itens, observações, cliente, pagamento e origem chegam no mesmo registro."], ["02", "A equipe avança o trabalho", "Quadros visuais e estados claros mostram o que está parado e o que vem depois."], ["03", "Todos acompanham o resultado", "Empresa e cliente recebem a atualização certa sem depender de ligações repetidas."]].map(([number, title, text]) => <li key={number} className="flex gap-4"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-500 font-black">{number}</span><div><h3 className="font-black">{title}</h3><p className="mt-1 text-sm leading-6 text-slate-400">{text}</p></div></li>)}</ol></div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.05fr]">
          <div><Eyebrow>Visibilidade sem microgerenciar</Eyebrow><h2 className="mt-4 text-4xl font-black tracking-[-.04em] sm:text-5xl">Você enxerga o turno antes que o problema cresça.</h2><p className="mt-5 text-lg leading-8 text-slate-600 dark:text-slate-400">O painel resume o que merece atenção, enquanto as telas operacionais cuidam do detalhe. Cores e movimentos têm função: destacar atraso, mudança de etapa e próximo passo.</p><div className="mt-8 grid gap-3 sm:grid-cols-2">{["Pedidos atrasados em evidência","Mesas paradas ou aguardando","Receita e volume do dia","Entregas e responsáveis","Histórico de cada pedido","Relatórios para decidir"].map((item) => <p key={item} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-bold shadow-sm dark:bg-slate-900 dark:border-slate-800"><span className="mr-2 text-emerald-600 dark:text-emerald-400">●</span>{item}</p>)}</div></div>
          <DashboardPreview />
        </div>
      </section>

      <section id="inteligencia" className="bg-[#fff2e7] dark:bg-[#120a04] py-24">
        <div className="mx-auto max-w-7xl px-5">
          <div className="grid gap-10 lg:grid-cols-[.85fr_1.15fr]"><div><Eyebrow>Inteligência com contexto</Eyebrow><h2 className="mt-4 text-4xl font-black tracking-[-.04em] sm:text-5xl">Uma IA que conhece o papel que está exercendo.</h2><p className="mt-5 text-lg leading-8 text-slate-700 dark:text-slate-300">Atendimento, operação e entrega não são a mesma conversa. Por isso, os agentes trabalham com contextos e ferramentas adequados a cada área.</p><p className="mt-5 rounded-2xl border border-orange-200 bg-white/70 p-4 text-sm leading-6 text-slate-600 dark:bg-slate-900/70 dark:border-orange-900/60 dark:text-slate-400">A IA sugere, consulta e prepara ações. Confirmações importantes continuam visíveis para que sua equipe mantenha o controle.</p></div><div className="grid gap-4 sm:grid-cols-3"><AgentCard number="01" title="Atendimento" text="Entende pedidos naturais, encontra produtos e ajuda clientes sem respostas engessadas." /><AgentCard number="02" title="Operação" text="Consulta informações do negócio e apoia tarefas internas no contexto da empresa." /><AgentCard number="03" title="Entrega" text="Ajuda o motoboy com a corrida atual, endereço, status e comunicação necessária." /></div></div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-24">
        <div className="text-center"><Eyebrow>Feito para quem faz acontecer</Eyebrow><h2 className="mx-auto mt-4 max-w-3xl text-4xl font-black tracking-[-.04em] sm:text-5xl">Uma experiência coerente para cada lado da operação.</h2></div>
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">{[["Gestão", "Visão do negócio, equipe, cardápio, pedidos, clientes e resultados."], ["Equipe", "Rotina clara, permissões por função e menos dependência de mensagens soltas."], ["Motoboy", "Entregas atribuídas, status, localização e informações da corrida."], ["Cliente", "Descoberta local, compra intuitiva, assistência e acompanhamento do pedido."]].map(([title, text], index) => <article key={title} className="rounded-[28px] bg-slate-950 p-6 text-white"><span className="text-xs font-black text-brand-400">0{index + 1}</span><h3 className="mt-12 text-xl font-black">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-400">{text}</p></article>)}</div>
      </section>

      <section id="preco" className="bg-white py-24 dark:bg-slate-900">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-[.9fr_1.1fr]"><div><Eyebrow>Comece completo</Eyebrow><h2 className="mt-4 text-4xl font-black tracking-[-.04em] sm:text-5xl">Um plano direto.<br />Sem esconder a operação.</h2><p className="mt-5 max-w-xl text-lg leading-8 text-slate-600 dark:text-slate-400">Nesta fase, o ChegowIA oferece um plano único com o conjunto completo de recursos. Sua empresa entra com a estrutura necessária para delivery, salão e gestão — e testa tudo por 7 dias antes de decidir.</p><a href="#contato" className="mt-6 inline-block text-sm font-black text-brand-700 hover:underline dark:text-brand-300">Ainda tem dúvidas? Converse com alguém →</a></div><article className="relative overflow-hidden rounded-[36px] bg-slate-950 p-7 text-white shadow-2xl sm:p-9"><div className="absolute -right-12 -top-14 h-48 w-48 rounded-full bg-brand-500/25 blur-3xl" /><div className="relative"><div className="flex items-center justify-between gap-3"><span className="rounded-full bg-brand-500 px-3 py-1 text-[10px] font-black uppercase tracking-wider">Plano profissional</span><span className="text-xs font-bold text-emerald-300">7 dias grátis</span></div><div className="mt-7 flex items-end gap-2"><strong className="text-5xl font-black tracking-tight">{formatCurrency(monthlyPrice)}</strong><span className="pb-2 text-sm text-slate-400">/mês depois do teste</span></div><p className="mt-3 text-sm text-slate-300">Operação completa em uma única assinatura.</p><p className="mt-2 text-[11px] leading-5 text-slate-400">Durante o teste você não paga nada. IA e WhatsApp são medidos e entram na primeira fatura apenas se você optar por continuar.</p><div className="my-7 grid gap-3 sm:grid-cols-2">{["Pedidos delivery e retirada","Mesas e pedidos locais","Cozinha e fluxo em tempo real","Entregas e motoboys","Clientes, equipe e permissões","Relatórios e assistentes de IA","Atualizações contínuas","Suporte à operação"].map((item) => <p key={item} className="text-sm font-semibold text-slate-200">✓ {item}</p>)}</div><Link href="/planos"><Button size="lg" className="h-14 w-full rounded-2xl text-base font-black">Começar teste grátis</Button></Link><p className="mt-4 text-center text-[11px] text-slate-500 dark:text-slate-400">Código de parceiro válido dá 15% de desconto nos primeiros 3 meses após a ativação.</p></div></article></div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-24">
        <div className="overflow-hidden rounded-[38px] bg-gradient-to-br from-brand-600 to-orange-400 p-8 text-white shadow-2xl sm:p-12"><div className="grid items-center gap-8 lg:grid-cols-[1fr_auto]"><div><p className="text-xs font-black uppercase tracking-[.17em] text-orange-100">Programa de parceiros</p><h2 className="mt-3 max-w-3xl text-3xl font-black tracking-tight sm:text-4xl">Conhece empresas que precisam operar melhor?</h2><p className="mt-4 max-w-2xl leading-7 text-orange-50">Revendedores aprovados recebem 30% da mensalidade do plano dos clientes vinculados, após os 7 dias de teste e a compensação do pagamento pelo Asaas.</p></div><Link href="/revenda"><Button size="lg" className="h-14 rounded-2xl bg-slate-950 px-7 font-black hover:bg-slate-900">Quero ser parceiro</Button></Link></div></div>
      </section>

      <section id="duvidas" className="bg-white py-24 dark:bg-slate-900">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 lg:grid-cols-[.7fr_1.3fr]"><div><Eyebrow>Perguntas frequentes</Eyebrow><h2 className="mt-4 text-4xl font-black tracking-[-.04em]">Antes de começar.</h2><p className="mt-4 leading-7 text-slate-600 dark:text-slate-400">Reunimos as dúvidas mais importantes sobre operação, implantação e inteligência artificial.</p></div><div className="divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800">{FAQ.map(([question, answer], index) => <article key={question}><button className="flex w-full items-center justify-between gap-5 py-5 text-left font-black" onClick={() => setOpenFaq(openFaq === index ? null : index)}><span>{question}</span><span className={`text-xl text-brand-600 transition ${openFaq === index ? "rotate-45" : ""}`}>+</span></button>{openFaq === index && <p className="max-w-3xl pb-6 text-sm leading-7 text-slate-600 dark:text-slate-400">{answer}</p>}</article>)}</div></div>
      </section>

      <section id="contato" className="bg-slate-950 py-24 text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 lg:grid-cols-[.85fr_1.15fr]"><div><Eyebrow light>Comercial e onboarding</Eyebrow><h2 className="mt-4 text-4xl font-black tracking-[-.04em] sm:text-5xl">Vamos entender sua operação?</h2><p className="mt-5 max-w-lg text-lg leading-8 text-slate-300">Tire dúvidas sobre a plataforma no WhatsApp comercial. Para falar com uma pessoa, preencha o formulário ou use o canal de atendimento humano abaixo.</p><a href={CHEGOWIA_WHATSAPP_URL} target="_blank" rel="noreferrer" className="mt-7 inline-flex min-h-14 items-center justify-center rounded-2xl bg-emerald-500 px-6 text-sm font-black text-white shadow-lg transition hover:bg-emerald-400">Tirar dúvidas no WhatsApp comercial <span className="ml-2" aria-hidden>↗</span></a><p className="mt-2 text-xs font-semibold text-emerald-200">{CHEGOWIA_SALES_WHATSAPP_NUMBER}</p><a href={CHEGOWIA_HUMAN_SUPPORT_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-emerald-500/70 bg-emerald-950/30 px-4 py-2.5 text-sm font-black text-emerald-100 transition hover:bg-emerald-900/50">Atendimento humano e suporte avançado ↗</a><p className="mt-2 text-xs font-semibold text-emerald-200">{CHEGOWIA_HUMAN_SUPPORT_WHATSAPP_NUMBER}</p><div className="mt-8 space-y-3 text-sm text-slate-400"><p>✓ Conversa sobre a sua realidade</p><p>✓ Explicação dos fluxos relevantes</p><p>✓ Orientação para contratação e implantação</p></div></div><div className="rounded-[32px] border border-slate-200/80 bg-white p-6 text-slate-950 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:shadow-black/40 sm:p-8">{sent ? <div className="grid min-h-[420px] place-items-center text-center"><div><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-3xl text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">✓</div><h3 className="mt-5 text-2xl font-black">Recebemos seu contato.</h3><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500 dark:text-slate-400">A oportunidade já foi enviada aos parceiros disponíveis. Fique atento ao telefone informado.</p><Button variant="outline" className="mt-6" onClick={() => setSent(false)}>Enviar outro contato</Button></div></div> : <div className="space-y-4"><div><h3 className="text-2xl font-black">Fale com um especialista</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Campos rápidos. Conversa humana.</p></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Seu nome" k="name" form={form} setForm={setForm} /><Field label="Empresa" k="companyName" form={form} setForm={setForm} /></div><div className="grid gap-4 sm:grid-cols-2"><Field label="E-mail" k="email" form={form} setForm={setForm} type="email" /><Field label="WhatsApp" k="phone" form={form} setForm={setForm} mask="phone" /></div><div className="grid grid-cols-[1fr_150px] gap-4"><Field label="Cidade" k="city" form={form} setForm={setForm} /><FormField label="UF"><BrazilStateSelect value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} /></FormField></div><FormField label="O que você quer melhorar?"><Textarea className="min-h-28" value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} /></FormField>{send.error && <p className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{apiErrorMessage(send.error)}</p>}<Button size="lg" className="h-14 w-full rounded-2xl font-black" isLoading={send.isPending} onClick={() => send.mutate()}>Quero conversar sobre minha operação</Button><p className="text-center text-[10px] leading-5 text-slate-400">Ao enviar, você autoriza o contato comercial sobre o ChegowIA.</p></div>}</div></div>
      </section>

      <footer className="border-t border-white/10 bg-slate-950 text-white"><div className="mx-auto grid max-w-7xl gap-8 px-5 py-12 sm:grid-cols-2 lg:grid-cols-4"><div><div className="inline-flex"><BrandLogo light className="h-8 w-36" /></div><p className="mt-4 max-w-xs text-sm leading-6 text-slate-500 dark:text-slate-400">Tecnologia para operações gastronômicas trabalharem com clareza, ritmo e proximidade.</p></div><FooterColumn title="Produto" links={[["Plataforma", "#plataforma"], ["Como funciona", "#operacao"], ["Plano", "#preco"], ["Entrar", "/login"]]} /><FooterColumn title="Parcerias" links={[["Seja revendedor", "/revenda"], ["Portal do parceiro", "/login?trocar-conta=revendedor"], ["Falar com vendas", "#contato"]]} /><div><p className="text-sm font-black">Contato</p><a className="mt-4 block text-sm text-slate-400 hover:text-white" href="mailto:contato@chegowia.com.br">contato@chegowia.com.br</a><a className="mt-3 block text-sm text-emerald-300 hover:text-emerald-200" href={CHEGOWIA_WHATSAPP_URL} target="_blank" rel="noreferrer">WhatsApp comercial: {CHEGOWIA_SALES_WHATSAPP_NUMBER}</a><a className="mt-3 block text-sm text-emerald-300 hover:text-emerald-200" href={CHEGOWIA_HUMAN_SUPPORT_WHATSAPP_URL} target="_blank" rel="noopener noreferrer">Atendimento humano: {CHEGOWIA_HUMAN_SUPPORT_WHATSAPP_NUMBER}</a><p className="mt-6 text-xs text-slate-600 dark:text-slate-400">ChegowIA · Brasil</p></div></div><div className="border-t border-white/10"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-2 px-5 py-5 text-xs text-slate-600 sm:flex-row dark:text-slate-400"><p>© {new Date().getFullYear()} ChegowIA. Todos os direitos reservados.</p><p>Operação com inteligência. Pessoas no controle.</p></div></div></footer>
    </main>
  );
}

function Eyebrow({ children, light = false }: { children: React.ReactNode; light?: boolean }) { return <p className={`text-xs font-black uppercase tracking-[.17em] ${light ? "text-brand-300" : "text-brand-700 dark:text-brand-300"}`}>{children}</p>; }
function Proof({ value, label }: { value: string; label: string }) { return <div className="px-5 py-4 first:pl-0"><p className="font-black">{value}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{label}</p></div>; }
function AgentCard({ number, title, text }: { number: string; title: string; text: string }) { return <article className="flex min-h-[270px] flex-col rounded-[28px] bg-white p-6 shadow-sm dark:bg-slate-900"><span className="text-xs font-black text-brand-600">{number}</span><div className="mt-auto"><h3 className="text-xl font-black">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">{text}</p></div></article>; }
function Field({ label, k, form, setForm, type = "text", mask }: any) { return <FormField label={label}>{mask ? <MaskedInput mask={mask} value={form[k]} onChange={(event) => setForm({ ...form, [k]: event.target.value })} /> : <Input type={type} value={form[k]} onChange={(event) => setForm({ ...form, [k]: event.target.value })} />}</FormField>; }
function FooterColumn({ title, links }: { title: string; links: string[][] }) { return <div><p className="text-sm font-black">{title}</p><div className="mt-4 space-y-3">{links.map(([label, href]) => <a key={href} className="block text-sm text-slate-400 hover:text-white" href={href}>{label}</a>)}</div></div>; }
function DashboardPreview() {
  return <div className="relative rounded-[34px] bg-slate-950 p-4 shadow-2xl sm:p-6"><div className="flex items-center justify-between"><div className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-400" /><span className="h-2.5 w-2.5 rounded-full bg-amber-300" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /></div><span className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Visão da operação</span></div><div className="mt-5 grid grid-cols-3 gap-2">{[["18", "Pedidos hoje", "bg-sky-400"], ["R$ 824", "Receita hoje", "bg-emerald-400"], ["2", "Precisam atenção", "bg-rose-400"]].map(([value, label, color]) => <div key={label} className="rounded-2xl bg-white/[.07] p-3 text-white"><span className={`block h-1.5 w-8 rounded-full ${color}`} /><strong className="mt-4 block text-lg sm:text-2xl">{value}</strong><span className="text-[9px] text-slate-500 dark:text-slate-400">{label}</span></div>)}</div><div className="mt-3 grid gap-2 sm:grid-cols-[1.3fr_.7fr]"><div className="rounded-2xl bg-white/[.07] p-4"><div className="flex items-center justify-between"><span className="text-xs font-black text-white">Fluxo de pedidos</span><span className="text-[9px] text-emerald-300">● ao vivo</span></div><div className="mt-4 grid grid-cols-3 gap-2">{[["Recebidos", "3", "border-sky-400/40 bg-sky-400/10"], ["Em preparo", "4", "border-amber-400/40 bg-amber-400/10"], ["Prontos", "2", "border-emerald-400/40 bg-emerald-400/10"]].map(([label, value, color]) => <div key={label} className={`rounded-xl border p-2 ${color}`}><span className="text-[8px] text-slate-400">{label}</span><strong className="block text-lg text-white">{value}</strong></div>)}</div></div><div className="rounded-2xl bg-brand-500 p-4 text-white"><span className="text-[9px] font-black uppercase">Próxima ação</span><p className="mt-5 text-sm font-black">2 pedidos prontos para retirada</p><span className="mt-3 block text-[9px] text-orange-100">Ver entregas →</span></div></div></div>;
}
