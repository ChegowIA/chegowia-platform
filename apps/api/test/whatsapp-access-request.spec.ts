import { MessagingService } from "../src/messaging/messaging.service";

/**
 * No self-serve do Gupshup o aplicativo de cada empresa é criado à mão. O pedido
 * do empresário é o gatilho desse trabalho — se ele não avisar ninguém, o
 * superadmin só descobre quando o cliente cobra. Estes testes fixam o aviso e o
 * cuidado de não repetir e-mail a cada clique.
 */
describe("pedido de acesso ao WhatsApp", () => {
  function buildService(existing: any) {
    const channel = { id: "canal-1", companyId: "empresa-1", provider: "GUPSHUP", status: "INATIVO", config: {} };
    const prisma = {
      messagingChannel: {
        findUnique: jest.fn().mockResolvedValue(existing),
        upsert: jest.fn().mockResolvedValue({ ...channel, accessRequestedAt: new Date() }),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue({ name: "Pizzaria do João", slug: "pizzaria", city: "Goiânia", state: "GO" }),
      },
    };
    const mail = { sendOperationsAlert: jest.fn().mockResolvedValue(undefined) };
    const realtime = { emitToSuperAdmins: jest.fn() };
    const service = new MessagingService(
      prisma as never,
      {} as never,
      {} as never,
      { isConfigured: jest.fn().mockReturnValue(true) } as never,
      mail as never,
      {} as never,
      {} as never,
      realtime as never,
    );
    return { service, prisma, mail, realtime };
  }

  it("avisa a equipe por e-mail e em tempo real no primeiro pedido", async () => {
    const { service, mail, realtime } = buildService(null);

    await service.requestWhatsappAccess("empresa-1");

    expect(realtime.emitToSuperAdmins).toHaveBeenCalledWith(
      "whatsapp.access.requested",
      expect.objectContaining({ companyId: "empresa-1", companyName: "Pizzaria do João" }),
    );
    const [subject, lines] = mail.sendOperationsAlert.mock.calls[0];
    expect(subject).toContain("WhatsApp");
    // O aviso precisa levar direto à página onde há trabalho a fazer.
    expect(lines.join("\n")).toContain("/super-admin/empresas/empresa-1");
    expect(lines.join("\n")).toContain("Pizzaria do João");
  });

  it("não repete o aviso quando o empresário clica de novo", async () => {
    const requestedBefore = new Date("2026-08-10T12:00:00Z");
    const { service, mail, realtime, prisma } = buildService({ accessRequestedAt: requestedBefore });

    await service.requestWhatsappAccess("empresa-1");

    expect(mail.sendOperationsAlert).not.toHaveBeenCalled();
    expect(realtime.emitToSuperAdmins).not.toHaveBeenCalled();
    // A data original é preservada: é ela que diz há quanto tempo a empresa espera.
    expect(prisma.messagingChannel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { accessRequestedAt: requestedBefore } }),
    );
  });

  it("registra o pedido mesmo se o e-mail falhar", async () => {
    const { service, mail } = buildService(null);
    mail.sendOperationsAlert.mockRejectedValueOnce(new Error("SMTP fora do ar"));

    // Para o empresário o pedido foi feito; o registro no banco é o que importa.
    await expect(service.requestWhatsappAccess("empresa-1")).resolves.toEqual(
      expect.objectContaining({ connected: false }),
    );
  });

  it("registra o pedido mesmo se o aviso em tempo real falhar", async () => {
    const { service, realtime } = buildService(null);
    realtime.emitToSuperAdmins.mockImplementationOnce(() => {
      throw new Error("gateway indisponível");
    });

    await expect(service.requestWhatsappAccess("empresa-1")).resolves.toEqual(
      expect.objectContaining({ connected: false }),
    );
  });
});
