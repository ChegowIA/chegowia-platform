import {
  DIAS_DE_CARENCIA_NO_CATALOGO,
  assinaturaDentroDaCarencia,
  assinaturaPermiteAparecerNoCatalogo,
} from "../src/common/public-visibility/subscription-grace";
import { BillingService } from "../src/billing/billing.service";

/**
 * Carência de sete dias entre vencer e sair do ar.
 *
 * Antes o painel do lojista era bloqueado no vencimento e a vitrine seguia
 * aceitando pedido: quem parava de pagar continuava vendendo por tempo
 * indeterminado. Cortar no mesmo dia também não servia — Pix que demora algumas
 * horas tiraria a loja do ar em dia de movimento.
 */
describe("carência da assinatura", () => {
  const agora = new Date("2026-08-20T12:00:00Z");
  const dias = (quantidade: number) => new Date(agora.getTime() - quantidade * 24 * 60 * 60 * 1000);

  it("são sete dias", () => {
    expect(DIAS_DE_CARENCIA_NO_CATALOGO).toBe(7);
  });

  it("período em curso aparece", () => {
    expect(assinaturaDentroDaCarencia({ currentPeriodEnd: dias(-3), trialEndsAt: null }, agora)).toBe(true);
  });

  it("vencida ontem ainda aparece", () => {
    expect(assinaturaDentroDaCarencia({ currentPeriodEnd: dias(1), trialEndsAt: null }, agora)).toBe(true);
  });

  it("vencida há seis dias ainda aparece", () => {
    expect(assinaturaDentroDaCarencia({ currentPeriodEnd: dias(6), trialEndsAt: null }, agora)).toBe(true);
  });

  it("vencida há oito dias sai do ar", () => {
    expect(assinaturaDentroDaCarencia({ currentPeriodEnd: dias(8), trialEndsAt: null }, agora)).toBe(false);
  });

  it("teste gratuito vencido conta igual", () => {
    expect(assinaturaDentroDaCarencia({ currentPeriodEnd: null, trialEndsAt: dias(2) }, agora)).toBe(true);
    expect(assinaturaDentroDaCarencia({ currentPeriodEnd: null, trialEndsAt: dias(9) }, agora)).toBe(false);
  });

  it("vale a data mais recente entre teste e período", () => {
    // Quem pagou depois do teste tem `currentPeriodEnd` novo e `trialEndsAt`
    // antigo; olhar só o teste tiraria do ar uma loja em dia.
    expect(assinaturaDentroDaCarencia({ currentPeriodEnd: dias(1), trialEndsAt: dias(40) }, agora)).toBe(true);
  });

  it("empresa sem assinatura continua visível", () => {
    // São as lojas criadas direto pelo super admin, que nunca passaram pelo
    // cadastro com plano.
    expect(assinaturaDentroDaCarencia(null, agora)).toBe(true);
    expect(assinaturaDentroDaCarencia(undefined, agora)).toBe(true);
  });

  it("assinatura sem nenhuma data não derruba a loja", () => {
    // Registro antigo do caminho da Stripe nascia assim. Não há o que comparar,
    // e o bloqueio do painel continua valendo para esse caso.
    expect(assinaturaDentroDaCarencia({ currentPeriodEnd: null, trialEndsAt: null }, agora)).toBe(true);
  });

  it("aceita data em texto, como vem do JSON", () => {
    expect(assinaturaDentroDaCarencia({ currentPeriodEnd: dias(8).toISOString() }, agora)).toBe(false);
    expect(assinaturaDentroDaCarencia({ currentPeriodEnd: dias(1).toISOString() }, agora)).toBe(true);
  });
});

describe("filtro do catálogo", () => {
  const agora = new Date("2026-08-20T12:00:00Z");

  it("o limite fica exatamente sete dias atrás", () => {
    const filtro = assinaturaPermiteAparecerNoCatalogo(agora) as any;
    const limite = filtro.OR[1].subscription.is.currentPeriodEnd.gte as Date;
    expect(Math.round((agora.getTime() - limite.getTime()) / (24 * 60 * 60 * 1000))).toBe(7);
  });

  it("deixa passar quem não tem assinatura, quem tem período válido e quem tem teste válido", () => {
    const filtro = assinaturaPermiteAparecerNoCatalogo(agora) as any;
    // A forma positiva é proposital: negar combinação de nulos com datas é onde
    // um erro silencioso esconderia loja pagante.
    expect(filtro.OR).toHaveLength(4);
    expect(filtro.OR[0]).toEqual({ subscription: { is: null } });
    expect(filtro.OR[2].subscription.is.trialEndsAt.gte).toBeInstanceOf(Date);
    expect(filtro.OR[3]).toEqual({ subscription: { is: { currentPeriodEnd: null, trialEndsAt: null } } });
  });
});

/**
 * O lojista precisa ver o prazo.
 *
 * A loja sair do catálogo é o efeito que o faz parar de vender. Descobrir isso
 * quando o pedido deixa de entrar é o que transforma uma regra de cobrança em
 * punição silenciosa — e em ligação para o suporte.
 */
describe("prazo mostrado no painel do lojista", () => {
  const agora = new Date("2026-08-20T12:00:00Z");
  const dias = (quantidade: number) => new Date(agora.getTime() + quantidade * 24 * 60 * 60 * 1000);

  function situacao(subscription: any) {
    const service: any = Object.create(BillingService.prototype);
    return service.situacaoNoCatalogo(subscription, agora);
  }

  it("período em curso: loja visível, sem contagem de aviso", () => {
    const resultado = situacao({ currentPeriodEnd: dias(20), trialEndsAt: null });
    expect(resultado.visible).toBe(true);
    expect(resultado.daysRemaining).toBe(27);
  });

  it("vencida há dois dias: avisa que faltam cinco", () => {
    const resultado = situacao({ currentPeriodEnd: dias(-2), trialEndsAt: null });
    expect(resultado.visible).toBe(true);
    expect(resultado.daysRemaining).toBe(5);
  });

  it("vencida há dez dias: já saiu", () => {
    const resultado = situacao({ currentPeriodEnd: dias(-10), trialEndsAt: null });
    expect(resultado.visible).toBe(false);
    expect(resultado.daysRemaining).toBe(0);
  });

  it("usa a data mais recente entre teste e período", () => {
    const resultado = situacao({ currentPeriodEnd: dias(-1), trialEndsAt: dias(-40) });
    expect(resultado.daysRemaining).toBe(6);
  });

  it("assinatura sem datas não inventa prazo", () => {
    expect(situacao({ currentPeriodEnd: null, trialEndsAt: null })).toEqual({
      visible: true, hiddenAt: null, daysRemaining: null,
    });
  });

  it("o prazo mostrado é o mesmo que a vitrine aplica", () => {
    // Duas contas separadas divergiriam com o tempo, e a tela passaria a
    // prometer um prazo que a vitrine não cumpre.
    const vencidaNoLimite = { currentPeriodEnd: dias(-DIAS_DE_CARENCIA_NO_CATALOGO - 1), trialEndsAt: null };
    expect(situacao(vencidaNoLimite).visible).toBe(false);
    expect(assinaturaDentroDaCarencia(vencidaNoLimite, agora)).toBe(false);
  });
});
