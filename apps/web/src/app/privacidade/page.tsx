import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const sections = [
  ["1. Quem controla os dados", "O ChegowIA é responsável pelo tratamento dos dados necessários à administração da plataforma. Empresas que usam o sistema também podem atuar como controladoras dos dados de seus próprios clientes, funcionários e pedidos. O canal de privacidade é contato@chegowia.com.br."],
  ["2. Dados que tratamos", "Podemos tratar identificação e contato, CPF ou CNPJ, endereço, perfil de acesso, dados da empresa, pedidos e pagamentos, histórico operacional, localização compartilhada durante entregas, mensagens de suporte, currículo e informações de candidatura, eventos técnicos, IP, dispositivo e registros de segurança."],
  ["3. Finalidades e bases legais", "Usamos os dados para executar contratos e pedidos, criar e proteger contas, processar pagamentos e comissões, operar entregas, mesas e atendimento, prevenir fraude, cumprir obrigações legais, prestar suporte, melhorar a plataforma e exercer direitos. Quando necessário, solicitamos consentimento específico, que pode ser revogado sem afetar tratamentos anteriores legítimos."],
  ["4. Inteligência artificial e revisão humana", "Alguns cadastros e interações podem receber análise automatizada para organizar informações, avaliar completude e auxiliar uma decisão inicial. Não utilizamos categorias sensíveis para decidir candidaturas. Quando a decisão produzir efeito relevante, o titular pode solicitar explicação e revisão humana pelo canal de privacidade."],
  ["5. Compartilhamento", "Compartilhamos somente o necessário com empresas envolvidas no pedido, processadores de pagamento, provedores de e-mail, infraestrutura, segurança e inteligência artificial, além de autoridades quando houver obrigação legal. Cada fornecedor deve tratar dados conforme contrato, finalidade e medidas de segurança compatíveis."],
  ["6. Pagamentos", "Dados completos de cartão e conta bancária são tratados pelo Stripe. O ChegowIA recebe identificadores, estado da cobrança, valores e informações necessárias à conciliação, assinatura, descontos e repasses, sem armazenar o número completo do cartão."],
  ["7. Armazenamento e segurança", "Dados e arquivos são armazenados em infraestrutura controlada pelo ChegowIA e protegidos por controles de acesso, criptografia em trânsito, registros de auditoria, cópias de segurança e verificação de arquivos. Nenhum sistema elimina totalmente os riscos; incidentes relevantes serão tratados e comunicados conforme a legislação."],
  ["8. Retenção", "Mantemos os dados pelo tempo necessário para a finalidade, contrato, prevenção de fraude, defesa de direitos e obrigações fiscais ou legais. Tokens temporários expiram automaticamente. Currículos e candidaturas recusadas seguem prazo operacional limitado e podem ser eliminados quando não houver base para conservação."],
  ["9. Seus direitos", "Nos termos da LGPD, você pode solicitar confirmação e acesso, correção, portabilidade quando aplicável, informação sobre compartilhamento, oposição, revisão de decisões automatizadas, revogação de consentimento, anonimização ou eliminação quando juridicamente cabível. Podemos confirmar sua identidade antes de atender ao pedido."],
  ["10. Cookies, alterações e contato", "Usamos cookies estritamente necessários para autenticação e segurança e, somente quando configurado com a base adequada, recursos de medição. Esta política pode mudar com o produto ou a legislação; alterações relevantes serão comunicadas. Solicitações: contato@chegowia.com.br."],
];

export default function PrivacyPage() {
  return <main className="min-h-screen bg-[#f6f2ec] dark:bg-[#080d18] text-slate-950 dark:text-slate-100">
    <header className="border-b border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-800/80"><div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4"><Link href="/"><BrandLogo adaptive className="h-10 w-44"/></Link><div className="flex items-center gap-3"><ThemeToggle /><Link href="/termos" className="text-sm font-bold text-brand-700 hover:underline dark:text-brand-300">Termos de Uso</Link></div></div></header>
    <article className="mx-auto max-w-4xl px-5 py-12 sm:py-16">
      <p className="text-xs font-black uppercase tracking-[.18em] text-brand-700 dark:text-brand-300">Privacidade desde o desenho do produto</p>
      <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">Política de Privacidade</h1>
      <div className="mt-5 rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm leading-6 text-slate-700 dark:bg-brand-950/30 dark:border-brand-900/60 dark:text-slate-300"><strong>Versão de 30 de julho de 2026.</strong> Este documento explica como os dados pessoais são usados e como exercer seus direitos.</div>
      <div className="mt-10 space-y-8">{sections.map(([heading,body])=><section key={heading}><h2 className="text-xl font-black">{heading}</h2><p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-400">{body}</p></section>)}</div>
      <footer className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">ChegowIA · Brasil · <a className="font-bold text-brand-700 dark:text-brand-300" href="mailto:contato@chegowia.com.br">contato@chegowia.com.br</a></footer>
    </article>
  </main>;
}
