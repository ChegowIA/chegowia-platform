import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const sections = [
  ["1. Escopo", "Estes Termos regulam o uso da plataforma ChegowIA por clientes, empresas, funcionários, entregadores, revendedores e administradores. Cada perfil deve usar apenas as funções relacionadas à sua atividade e manter seus dados corretos e atualizados."],
  ["2. Cadastro e segurança", "O usuário declara que os dados informados são verdadeiros, possui capacidade para contratar e é responsável pela confidencialidade de sua senha. Contas são pessoais. Atividades suspeitas, compartilhamento de credenciais, fraude ou uso contrário à lei podem resultar em bloqueio preventivo e análise."],
  ["3. Empresas e operação", "A empresa é responsável pelo cardápio, disponibilidade, preços, informações dos produtos, atendimento, preparo, mesas, entregas e cumprimento das normas aplicáveis ao seu negócio. O ChegowIA fornece tecnologia de gestão e intermediação, mas não produz nem entrega os itens vendidos pelas empresas cadastradas."],
  ["4. Pedidos e pagamentos", "Preços, taxas, prazos e formas de pagamento são apresentados antes da confirmação. Pedidos podem ser recusados ou cancelados quando houver indisponibilidade, suspeita de fraude, endereço fora da cobertura ou impossibilidade operacional. Estornos observam o meio de pagamento e os prazos do processador financeiro."],
  ["5. Assinatura do software", "A assinatura empresarial é recorrente e permanece ativa enquanto os pagamentos estiverem em dia. Alterações de plano e preço serão informadas previamente quando exigido. O cancelamento impede novas cobranças, sem apagar obrigações já vencidas nem registros que precisem ser mantidos por obrigação legal."],
  ["6. Programa de revendedores", "Revendedores aprovados recebem comissão sobre mensalidades efetivamente pagas e elegíveis, conforme regras exibidas no portal. Estornos, chargebacks, fraude, cancelamentos e impostos podem alterar ou reverter comissões. O revendedor não pode prometer condições não publicadas nem se apresentar como empregado ou representante legal do ChegowIA."],
  ["7. Inteligência artificial", "Recursos de inteligência artificial auxiliam atendimento, descoberta, operação e análise inicial de cadastros. Respostas podem conter imprecisões e não substituem decisões profissionais. Decisões relevantes de candidatura podem ser submetidas à revisão humana, conforme a Política de Privacidade."],
  ["8. Uso aceitável", "É proibido violar direitos de terceiros, enviar conteúdo ilícito, tentar acessar contas ou dados sem autorização, contornar limites de segurança, explorar falhas, automatizar abusivamente o serviço ou utilizar a plataforma para fraude. Incidentes devem ser informados imediatamente."],
  ["9. Disponibilidade e responsabilidade", "Buscamos operação contínua e segura, mas manutenções, falhas de terceiros, internet ou eventos fora do controle razoável podem causar indisponibilidade. Na extensão permitida pela lei, a responsabilidade do ChegowIA se limita aos danos diretos comprovadamente causados pela plataforma."],
  ["10. Alterações e contato", "Podemos atualizar estes Termos para refletir mudanças legais ou do produto. Alterações relevantes serão comunicadas. Dúvidas, solicitações e notificações podem ser enviadas para contato@chegowia.com.br."],
];

export default function TermsPage() {
  return <LegalPage title="Termos de Uso" eyebrow="Regras claras para uma relação segura" sections={sections} />;
}

function LegalPage({title,eyebrow,sections}:{title:string;eyebrow:string;sections:string[][]}) {
  return <main className="min-h-screen bg-[#f6f2ec] dark:bg-[#080d18] text-slate-950 dark:text-slate-100">
    <header className="border-b border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-800/80"><div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4"><Link href="/"><BrandLogo adaptive className="h-10 w-44"/></Link><div className="flex items-center gap-3"><ThemeToggle /><Link href="/privacidade" className="text-sm font-bold text-brand-700 hover:underline dark:text-brand-300">Política de Privacidade</Link></div></div></header>
    <article className="mx-auto max-w-4xl px-5 py-12 sm:py-16">
      <p className="text-xs font-black uppercase tracking-[.18em] text-brand-700 dark:text-brand-300">{eyebrow}</p>
      <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">{title}</h1>
      <div className="mt-5 rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm leading-6 text-slate-700 dark:bg-brand-950/30 dark:border-brand-900/60 dark:text-slate-300"><strong>Versão de 30 de julho de 2026.</strong> Ao criar uma conta ou continuar usando o ChegowIA, você concorda com estes termos.</div>
      <div className="mt-10 space-y-8">{sections.map(([heading,body])=><section key={heading}><h2 className="text-xl font-black">{heading}</h2><p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-400">{body}</p></section>)}</div>
      <footer className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">ChegowIA · Brasil · <a className="font-bold text-brand-700 dark:text-brand-300" href="mailto:contato@chegowia.com.br">contato@chegowia.com.br</a></footer>
    </article>
  </main>;
}
