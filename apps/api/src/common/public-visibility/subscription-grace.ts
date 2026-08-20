/**
 * Até quando a loja continua no ar depois de a assinatura vencer.
 *
 * O painel do lojista já era bloqueado no vencimento, mas a vitrine seguia
 * aceitando pedido: quem parava de pagar continuava vendendo por tempo
 * indeterminado. Cortar no mesmo dia também não serve — Pix que demora algumas
 * horas e boleto que compensa no dia seguinte tirariam a loja do ar em dia de
 * movimento, e o prejuízo do lojista viraria problema do suporte.
 *
 * Sete dias cobrem o atraso normal de pagamento e ainda deixam claro que a
 * assinatura é obrigatória. A loja volta sozinha quando o pagamento entra,
 * porque o que conta é a data de fim do período, não um marcador separado.
 */
export const DIAS_DE_CARENCIA_NO_CATALOGO = 7;

/**
 * Filtro Prisma da visibilidade pública por assinatura.
 *
 * Escrito na forma positiva (quem *aparece*) de propósito: a forma negativa
 * exigia negar uma combinação de nulos e datas, e é justamente onde um erro
 * silencioso esconderia lojas pagantes.
 *
 * Empresa sem assinatura continua visível. É o caso das lojas criadas
 * diretamente pelo super admin, que nunca passaram pelo cadastro com plano — e
 * esconder essas seria uma mudança que ninguém pediu.
 */
export function assinaturaPermiteAparecerNoCatalogo(agora = new Date()) {
  const limite = new Date(agora.getTime() - DIAS_DE_CARENCIA_NO_CATALOGO * 24 * 60 * 60 * 1000);
  return {
    OR: [
      { subscription: { is: null } },
      { subscription: { is: { currentPeriodEnd: { gte: limite } } } },
      { subscription: { is: { trialEndsAt: { gte: limite } } } },
      // Assinatura sem período e sem teste é registro antigo — o caminho da
      // Stripe criava assim. Não há data para comparar, então ela não derruba a
      // loja; o bloqueio do painel continua valendo para esse caso.
      { subscription: { is: { currentPeriodEnd: null, trialEndsAt: null } } },
    ],
  };
}

/**
 * A mesma regra, aplicada a um registro já carregado.
 *
 * Existe porque esconder a loja do catálogo não impede o pedido: quem tem o link
 * direto, o carrinho aberto ou o número do WhatsApp continuaria comprando, e o
 * lojista poderia simplesmente parar de pagar e divulgar o link. A checagem no
 * momento do pedido é a que fecha isso.
 */
export function assinaturaDentroDaCarencia(
  subscription: { currentPeriodEnd?: Date | string | null; trialEndsAt?: Date | string | null } | null | undefined,
  agora = new Date(),
) {
  if (!subscription) return true;
  const limite = agora.getTime() - DIAS_DE_CARENCIA_NO_CATALOGO * 24 * 60 * 60 * 1000;
  const fimDoPeriodo = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).getTime() : null;
  const fimDoTeste = subscription.trialEndsAt ? new Date(subscription.trialEndsAt).getTime() : null;
  // Sem nenhuma das duas datas não há o que comparar: registro antigo não
  // derruba a loja, como no filtro do catálogo.
  if (fimDoPeriodo === null && fimDoTeste === null) return true;
  return (fimDoPeriodo !== null && fimDoPeriodo >= limite)
    || (fimDoTeste !== null && fimDoTeste >= limite);
}

/** Mesma frase nos três pontos de venda, para o cliente não receber explicações diferentes. */
export const LOJA_INDISPONIVEL_POR_ASSINATURA =
  "Esta loja está temporariamente indisponível. Tente novamente mais tarde.";
