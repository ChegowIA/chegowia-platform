import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AIChannel, AIAgentRole, Role } from "@prisma/client";
import { AiService } from "../src/ai/ai.service";
import { ToolsService } from "../src/ai/tools/tools.service";

/**
 * A quem cada real de IA e WhatsApp é cobrado.
 *
 * O risco que estes testes cobrem não é vazamento de dado — é vazamento de
 * dinheiro em duas direções: consumo de uma empresa cair na conta de outra, e
 * consumo real não cair na conta de ninguém (a plataforma paga sem cobrar).
 * O segundo é o mais insidioso, porque não gera reclamação: ninguém abre
 * chamado por uma conta baixa demais.
 */
describe("atribuição de consumo à empresa", () => {
  const respostaIa = {
    content: "ok",
    requestId: "req-1",
    usage: { inputTokens: 100, cachedInputTokens: 0, uncachedInputTokens: 100, outputTokens: 20 },
  };

  describe("agente do painel", () => {
    function build(conversa: any) {
      const registros: any[] = [];
      const prisma: any = {
        aIConversation: {
          findFirst: jest.fn().mockResolvedValue(conversa),
          findUnique: jest.fn().mockResolvedValue(conversa),
          create: jest.fn().mockResolvedValue(conversa),
          update: jest.fn().mockResolvedValue(conversa),
        },
        aIMessage: {
          create: jest.fn().mockResolvedValue({ id: "msg-1" }),
          findMany: jest.fn().mockResolvedValue([]),
        },
        company: { findUnique: jest.fn().mockResolvedValue({ id: conversa?.companyId, name: "Loja", settings: {} }) },
      };
      const usage = {
        recordAiUsage: jest.fn().mockImplementation((args: any) => { registros.push(args); return Promise.resolve({}); }),
      };
      const provider = { chat: jest.fn().mockResolvedValue(respostaIa) };
      const service = new AiService(
        prisma as never,
        provider as never,
        // promptBuilder, toolsService — não usados neste caminho.
        { build: jest.fn().mockResolvedValue("system") } as never,
        {} as never,
        usage as never,
        {} as never,
      );
      return { service, prisma, registros, provider };
    }

    const conversaDaAlfa = {
      id: "conv-1",
      companyId: "empresa-alfa",
      agentRole: AIAgentRole.OPERACIONAL,
      channel: AIChannel.INTERNO,
      userId: "func-1",
    };

    it("cobra a empresa dona da conversa, não quem digitou", async () => {
      // O funcionário não carrega o custo; a empresa dele carrega. É o ponto
      // de todo o modelo: o admin paga o que a equipe inteira consome.
      const { service, registros } = build(conversaDaAlfa);

      await service.sendMessageAsInternalUser("conv-1", "empresa-alfa", "oi").catch(() => undefined);

      expect(registros[0]?.companyId).toBe("empresa-alfa");
    });

    it("conversa de outra empresa não é alcançável — o filtro é por companyId", async () => {
      const { service, prisma } = build(null);

      await expect(service.sendMessageAsInternalUser("conv-1", "empresa-beta", "oi")).rejects.toThrow();

      expect(prisma.aIConversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ companyId: "empresa-beta" }) }),
      );
    });
  });

  describe("ferramenta que faz uma segunda chamada à IA", () => {
    it("registra o consumo na empresa que pediu", async () => {
      // Este era o vazamento: a descrição de produto chamava a IA de novo e
      // ninguém pagava. Quanto mais o lojista usasse, mais a plataforma perdia.
      const usage = { recordAiUsage: jest.fn().mockResolvedValue({}) };
      const provider = { chat: jest.fn().mockResolvedValue(respostaIa) };
      const tools = new ToolsService({} as never, provider as never, usage as never);

      await tools.generateProductDescription("empresa-alfa", { name: "X-Burger" });

      expect(usage.recordAiUsage).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: "empresa-alfa", inputTokens: 100, outputTokens: 20 }),
      );
    });

    it("resposta sem medição não inventa consumo", async () => {
      const usage = { recordAiUsage: jest.fn() };
      const provider = { chat: jest.fn().mockResolvedValue({ content: "ok" }) };
      const tools = new ToolsService({} as never, provider as never, usage as never);

      await tools.generateProductDescription("empresa-alfa", { name: "X-Burger" });

      expect(usage.recordAiUsage).not.toHaveBeenCalled();
    });
  });

  /**
   * Trava de arquitetura: toda chamada ao provedor de IA precisa estar num
   * destes dois grupos — registra consumo de uma empresa, ou é custo declarado
   * da plataforma. Um `chat(` novo sem nenhum dos dois quebra este teste, que
   * é o objetivo: a decisão de quem paga tem que ser tomada na hora de
   * escrever o código, não descoberta na fatura.
   */
  describe("nenhuma chamada de IA fica sem dono", () => {
    const RAIZ = join(__dirname, "..", "src");

    function arquivosComChamada() {
      const { execSync } = require("node:child_process");
      const saida = execSync(
        `grep -rn "\\.chat(" ${RAIZ} --include=*.ts | grep -v "ai-provider.interface" | grep -v "/providers/"`,
        { encoding: "utf8" },
      ).trim();
      return saida ? saida.split("\n") : [];
    }

    it("toda chamada registra consumo ou está marcada como custo da plataforma", () => {
      const semDono: string[] = [];

      for (const linha of arquivosComChamada()) {
        const [caminho, numero] = linha.split(":");
        const conteudo = readFileSync(caminho, "utf8").split("\n");
        const inicio = Math.max(0, Number(numero) - 12);
        const fim = Math.min(conteudo.length, Number(numero) + 12);
        const vizinhanca = conteudo.slice(inicio, fim).join("\n");

        const registra = /recordAiUsage/.test(vizinhanca);
        const declarada = /Custo da plataforma/.test(vizinhanca);
        if (!registra && !declarada) semDono.push(`${caminho}:${numero}`);
      }

      expect(semDono).toEqual([]);
    });
  });

  describe("canais sem contexto de tenant", () => {
    it("o WhatsApp resolve a empresa por um identificador único global", () => {
      // O aplicativo do Gupshup identifica o canal no callback público, por id e
      // por nome. Ambos são @unique no schema inteiro, não por empresa: é o que
      // impede uma mensagem cair na empresa errada.
      const schema = readFileSync(join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
      const modelo = schema.slice(schema.indexOf("model MessagingChannel"));
      const bloco = modelo.slice(0, modelo.indexOf("\n}"));

      expect(bloco).toMatch(/gupshupAppId\s+String\?\s+@unique/);
      expect(bloco).toMatch(/gupshupAppName\s+String\?\s+@unique/);
    });

    it("a conversa do cliente nasce da loja visitada, não de dado enviado por ele", () => {
      // `startOrGetCustomerConversation` resolve a empresa pelo slug da URL e
      // ignora qualquer companyId do corpo — o cliente não escolhe quem paga.
      const fonte = readFileSync(join(RAIZ_AI, "ai.service.ts"), "utf8");
      const trecho = fonte.slice(fonte.indexOf("async startOrGetCustomerConversation"));
      const corpo = trecho.slice(0, trecho.indexOf("\n  }"));

      expect(corpo).toContain("slug: companySlug");
      expect(corpo).toContain("isActive: true");
      expect(corpo).toContain("publicCompanyVisibilityWhereForUserId(userId)");
      expect(corpo).toContain("companyId: company.id");
    });
  });
});

const RAIZ_AI = join(__dirname, "..", "src", "ai");
