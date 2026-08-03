import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AIChannel, DiningOrderStatus, OrderStatus, Role } from "@prisma/client";
import { AiService } from "../src/ai/ai.service";

const TITULO = "Assistente da cozinha";

/**
 * Assistente da cozinha.
 *
 * A cozinha era o único papel operacional sem assistente. A diferença de
 * modelagem em relação a motoboy e garçom: o contexto **não** é filtrado por
 * pessoa. A fila de produção é da cozinha inteira — ninguém "tem" um pedido em
 * preparo, e recortar por quem lançou não descreveria o trabalho real.
 */
describe("assistente da cozinha", () => {
  const respostaIa = {
    content: "Comece pelo pedido mais antigo.",
    requestId: "req-1",
    usage: { inputTokens: 80, cachedInputTokens: 0, uncachedInputTokens: 80, outputTokens: 15 },
  };

  const conversa = {
    id: "conv-1",
    companyId: "empresa-alfa",
    channel: AIChannel.INTERNO,
    userId: "cozinha-1",
    title: TITULO,
  };

  function build(overrides: any = {}) {
    const prisma: any = {
      aIConversation: {
        findFirst: jest.fn().mockResolvedValue(overrides.conversa === undefined ? conversa : overrides.conversa),
        findUnique: jest.fn().mockResolvedValue(overrides.conversa === undefined ? conversa : overrides.conversa),
        create: jest.fn().mockResolvedValue(conversa),
        update: jest.fn().mockResolvedValue(conversa),
      },
      aIMessage: {
        create: jest.fn().mockResolvedValue({ id: "msg-1", content: "ok" }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue({ id: "empresa-alfa", name: "Loja", settings: { aiKnowledgeBase: null } }),
      },
      order: { findMany: jest.fn().mockResolvedValue(overrides.pedidos ?? []) },
      diningOrder: { findMany: jest.fn().mockResolvedValue(overrides.rodadas ?? []) },
    };
    const usage = { recordAiUsage: jest.fn().mockResolvedValue({}) };
    const provider = { chat: overrides.chat ?? jest.fn().mockResolvedValue(respostaIa) };
    const service = new AiService(
      prisma as never,
      provider as never,
      { build: jest.fn() } as never,
      {} as never,
      usage as never,
      {} as never,
    );
    return { service, prisma, usage, provider };
  }

  const pedidoDelivery = {
    id: "pedido-abcdef",
    status: OrderStatus.EM_PREPARO,
    createdAt: new Date(Date.now() - 25 * 60_000),
    notes: "Sem cebola",
    items: [{ quantity: 2, productName: "X-Burger", variationName: null, notes: "bem passado", addons: [] }],
  };

  const rodadaSalao = {
    id: "rodada-1",
    status: DiningOrderStatus.RECEBIDO,
    createdAt: new Date(Date.now() - 5 * 60_000),
    notes: null,
    items: [{ quantity: 1, productName: "Batata", notes: null }],
    tableSession: { table: { name: "Mesa 4" } },
  };

  it("cobra o consumo da empresa, não do cozinheiro", async () => {
    const { service, usage } = build({ pedidos: [pedidoDelivery] });

    await service.sendMessageAsKitchen("conv-1", "cozinha-1", "o que fazer primeiro?");

    expect(usage.recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "empresa-alfa" }),
    );
  });

  it("junta delivery e salão na mesma fila", async () => {
    // A cozinha produz para os dois e não distingue a origem ao montar o
    // prato; separar obrigaria a cruzar duas listas durante o pico.
    const { service, provider } = build({ pedidos: [pedidoDelivery], rodadas: [rodadaSalao] });

    await service.sendMessageAsKitchen("conv-1", "cozinha-1", "resumo");

    const [mensagens] = provider.chat.mock.calls[0];
    const contexto = mensagens[0].content;
    expect(contexto).toContain("X-Burger");
    expect(contexto).toContain("Mesa 4");
  });

  it("mostra há quanto tempo cada pedido espera — é o que define prioridade", async () => {
    const { service, provider } = build({ pedidos: [pedidoDelivery] });

    await service.sendMessageAsKitchen("conv-1", "cozinha-1", "prioridade");

    const contexto = provider.chat.mock.calls[0][0][0].content;
    expect(contexto).toMatch(/esperando há 2[45] min/);
  });

  it("leva as observações do item e do pedido", async () => {
    const { service, provider } = build({ pedidos: [pedidoDelivery] });

    await service.sendMessageAsKitchen("conv-1", "cozinha-1", "observações");

    const contexto = provider.chat.mock.calls[0][0][0].content;
    expect(contexto).toContain("bem passado");
    expect(contexto).toContain("Sem cebola");
  });

  it("não expõe dados do cliente nem valores — a cozinha não precisa e não vê no painel", async () => {
    const { service, prisma } = build({ pedidos: [pedidoDelivery] });

    await service.sendMessageAsKitchen("conv-1", "cozinha-1", "resumo");

    const select = prisma.order.findMany.mock.calls[0][0].select;
    for (const campo of ["customer", "customerId", "total", "deliveryStreet", "deliveryCity", "paymentMethod"]) {
      expect(select[campo]).toBeUndefined();
    }
  });

  it("só entram pedidos que a cozinha ainda produz ou entregou para retirada", async () => {
    const { service, prisma } = build();

    await service.sendMessageAsKitchen("conv-1", "cozinha-1", "fila");

    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual([OrderStatus.CONFIRMADO, OrderStatus.EM_PREPARO, OrderStatus.PRONTO]);
    expect(where.companyId).toBe("empresa-alfa");
  });

  it("conversa de outra pessoa é recusada", async () => {
    const { service } = build({ conversa: { ...conversa, userId: "outro" } });

    await expect(service.sendMessageAsKitchen("conv-1", "cozinha-1", "oi")).rejects.toThrow(/não tem acesso/i);
  });

  it("conversa de outro papel não vira assistente de cozinha", async () => {
    // Sem conferir o título, o cozinheiro alcançaria a conversa do garçom dele
    // mesmo — que carrega mesas e dados que a cozinha não deve ver.
    const { service } = build({ conversa: { ...conversa, title: "Assistente do garçom" } });

    await expect(service.sendMessageAsKitchen("conv-1", "cozinha-1", "oi")).rejects.toThrow(/não tem acesso/i);
  });

  it("provedor fora do ar não deixa a cozinha sem resposta", async () => {
    // No meio do pico, "erro" seria pior que uma resposta simples.
    const { service, prisma } = build({
      pedidos: [pedidoDelivery],
      chat: jest.fn().mockRejectedValue(new Error("provedor fora do ar")),
    });

    await service.sendMessageAsKitchen("conv-1", "cozinha-1", "o que fazer primeiro?");

    const salvas = prisma.aIMessage.create.mock.calls.map(([args]: any) => args.data.content);
    expect(salvas.at(-1)).toContain("X-Burger");
  });

  it("fila vazia responde isso, em vez de inventar", async () => {
    const { service, prisma } = build({ chat: jest.fn().mockRejectedValue(new Error("fora")) });

    await service.sendMessageAsKitchen("conv-1", "cozinha-1", "tem algo?");

    const salvas = prisma.aIMessage.create.mock.calls.map(([args]: any) => args.data.content);
    expect(salvas.at(-1)).toContain("Nenhum pedido na fila");
  });
});

/**
 * Trava: todo papel que opera dentro de uma empresa precisa ter assistente.
 *
 * A cozinha ficou de fora por um ano sem ninguém notar — não havia nada que
 * apontasse a ausência. Este teste falha quando um papel novo aparece sem o
 * controller correspondente.
 */
describe("cobertura de assistentes por papel", () => {
  const PAPEIS_OPERACIONAIS = [Role.ADMIN, Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM];

  it("todo papel operacional tem um controller de IA que o atende", () => {
    const dir = join(__dirname, "..", "src", "ai");
    const controllers = readdirSync(dir)
      .filter((nome) => nome.endsWith(".controller.ts"))
      .map((nome) => readFileSync(join(dir, nome), "utf8"));

    const semAssistente = PAPEIS_OPERACIONAIS.filter(
      (papel) => !controllers.some((fonte) => new RegExp(`Role\\.${papel}\\b`).test(fonte)),
    );

    expect(semAssistente).toEqual([]);
  });
});
