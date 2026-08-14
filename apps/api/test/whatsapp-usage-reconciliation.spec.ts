import { UsageMetric } from "@prisma/client";
import { UsageService } from "../src/usage/usage.service";
import { buildMessagingService } from "./support/messaging-services";

describe("conciliação de custo do WhatsApp", () => {
  it("mantém a tarifa do Gupshup quando a Meta isenta uma template utility", async () => {
    const existing = {
      id: "usage-1",
      metric: UsageMetric.WHATSAPP_TEMPLATE_UTILIDADE,
      quantity: 1,
      status: "PENDENTE",
      providerAmount: 0.040077,
      billableAmount: 0.0521,
      usageRateId: "utility-rate",
    };
    const serviceRate = {
      id: "service-rate",
      metric: UsageMetric.WHATSAPP_SERVICO,
      unitSize: 1,
      providerUnitCost: 0.005077,
      markupPercent: 30,
      isActive: true,
    };
    const prisma = {
      usageLedger: {
        findUnique: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data })),
      },
      usageRate: { findUnique: jest.fn().mockResolvedValue(serviceRate) },
    };
    const usage = new UsageService(prisma as never);

    const result = await usage.repriceWhatsAppUsage({
      companyId: "empresa-1",
      channelId: "canal-1",
      providerMessageId: "msg-1",
      pricingCategory: "utility",
      billable: false,
      deliveryConfirmed: true,
    });

    expect(prisma.usageRate.findUnique).toHaveBeenCalledWith({ where: { metric: UsageMetric.WHATSAPP_SERVICO } });
    expect(prisma.usageLedger.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metric: UsageMetric.WHATSAPP_SERVICO,
        providerAmount: 0.005077,
        billableAmount: 0.0066,
      }),
    }));
    expect(result).toEqual(expect.objectContaining({ metric: UsageMetric.WHATSAPP_SERVICO }));
  });

  it("deixa um marcador zerado quando a falha chega antes da persistência do envio", async () => {
    const created = { id: "usage-failed", quantity: 1, providerAmount: 0.005077, billableAmount: 0.0066 };
    const prisma = {
      usageLedger: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...created, ...data })),
      },
      usageRate: {
        findUnique: jest.fn().mockResolvedValue({
          id: "service-rate",
          unitSize: 1,
          providerUnitCost: 0.005077,
          markupPercent: 30,
          isActive: true,
        }),
      },
    };
    const usage = new UsageService(prisma as never);

    await usage.repriceWhatsAppUsage({
      companyId: "empresa-1",
      channelId: "canal-1",
      providerMessageId: "failed-before-persist",
      deliveryConfirmed: false,
    });

    expect(prisma.usageLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ externalReference: "whatsapp:failed-before-persist" }),
    }));
    expect(prisma.usageLedger.update).toHaveBeenCalledWith({
      where: { id: "usage-failed" },
      data: { providerAmount: 0, billableAmount: 0 },
    });
  });

  it("usa o billing-event do Gupshup para confirmar categoria e cobrança", async () => {
    const channel = {
      id: "canal-1",
      companyId: "empresa-1",
      status: "ATIVO",
      company: { id: "empresa-1", name: "Empresa", settings: { aiEnabled: true }, subscription: null },
    };
    const message = {
      id: "message-1",
      companyId: "empresa-1",
      channelId: "canal-1",
      providerMessageId: "gupshup-msg-1",
      direction: "ENVIADA",
    };
    const usage = {
      repriceWhatsAppUsage: jest.fn().mockResolvedValue({ providerAmount: 0.005077, billableAmount: 0.0066 }),
    };
    const prisma = {
      messagingChannel: { findUnique: jest.fn().mockResolvedValue(channel) },
      whatsAppMessage: {
        findUnique: jest.fn().mockResolvedValue(message),
        update: jest.fn().mockResolvedValue(message),
      },
    };
    const service = buildMessagingService({ prisma, usage });

    await service.handleGupshupWebhook({
      gs_app_id: "app-1",
      entry: [{ changes: [{
        field: "billing-event",
        value: {
          billing: {
            deductions: { category: "utility", billable: false },
            references: { id: "gupshup-msg-1" },
          },
        },
      }] }],
    });

    expect(usage.repriceWhatsAppUsage).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "empresa-1",
      providerMessageId: "gupshup-msg-1",
      pricingCategory: "utility",
      billable: false,
      deliveryConfirmed: true,
    }));
    expect(prisma.whatsAppMessage.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ providerCost: 0.005077, billableAmount: 0.0066 }),
    }));
  });

  it("também concilia o billing-event no formato self-serve v2", async () => {
    const channel = {
      id: "canal-1",
      companyId: "empresa-1",
      status: "ATIVO",
      company: { id: "empresa-1", name: "Empresa", settings: { aiEnabled: true }, subscription: null },
    };
    const usage = { repriceWhatsAppUsage: jest.fn().mockResolvedValue({ providerAmount: 0.005077, billableAmount: 0.0066 }) };
    const prisma = {
      messagingChannel: { findUnique: jest.fn().mockResolvedValue(channel) },
      whatsAppMessage: {
        findUnique: jest.fn().mockResolvedValue({
          id: "message-1",
          companyId: "empresa-1",
          channelId: "canal-1",
          direction: "ENVIADA",
        }),
        update: jest.fn(),
      },
    };
    const service = buildMessagingService({ prisma, usage });

    await service.handleGupshupSelfServeWebhook({
      app: "chegowiaempresa1",
      type: "billing-event",
      payload: {
        deductions: { type: "utility", billable: "false" },
        references: { id: "gupshup-msg-v2" },
      },
    });

    expect(usage.repriceWhatsAppUsage).toHaveBeenCalledWith(expect.objectContaining({
      providerMessageId: "gupshup-msg-v2",
      pricingCategory: "utility",
      billable: false,
      deliveryConfirmed: true,
    }));
  });

  it("contabiliza texto recebido pelo Gupshup, mas não mídia gratuita", async () => {
    const conversation = { id: "conv-1", mode: "HUMANO" };
    const usage = { recordWhatsAppUsage: jest.fn().mockResolvedValue({ providerAmount: 0.005077, billableAmount: 0.0066 }) };
    const prisma = {
      whatsAppMessage: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "message-1" }),
      },
      whatsAppConversation: {
        findUnique: jest.fn().mockResolvedValue(conversation),
        upsert: jest.fn().mockResolvedValue(conversation),
      },
    };
    const realtime = { emitToCompany: jest.fn() };
    const service = buildMessagingService({ prisma, usage, realtime });
    const channel = {
      id: "canal-1",
      companyId: "empresa-1",
      automationEnabled: false,
      company: { settings: { aiEnabled: false }, subscription: null },
    };

    await (service as any).processIncomingMessage(channel, [], {
      id: "inbound-text-1",
      from: "5562988887777",
      type: "text",
      text: { body: "Olá" },
    }, {});
    await (service as any).processIncomingMessage(channel, [], {
      id: "inbound-image-1",
      from: "5562988887777",
      type: "image",
    }, {});

    expect(usage.recordWhatsAppUsage).toHaveBeenCalledTimes(1);
    expect(usage.recordWhatsAppUsage).toHaveBeenCalledWith({
      companyId: "empresa-1",
      channelId: "canal-1",
      providerMessageId: "inbound-text-1",
      pricingCategory: "service",
    });
    expect(prisma.whatsAppMessage.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ providerCost: 0.005077, billableAmount: 0.0066 }),
    }));
    expect(prisma.whatsAppMessage.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ providerCost: 0, billableAmount: 0 }),
    }));
  });
});
