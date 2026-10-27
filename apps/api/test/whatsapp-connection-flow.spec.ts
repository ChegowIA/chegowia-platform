import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMessagingService } from "./support/messaging-services";

/**
 * Conexão do WhatsApp de uma empresa no modo self-serve do Gupshup.
 *
 * O vínculo do aplicativo é trabalho do superadmin. Se o dono da empresa
 * pudesse fazê-lo, bastaria informar o app de outro — ou o institucional da
 * ChegowIA — para receber as conversas dele e enviar em nome dele.
 */
describe("conexão do WhatsApp da empresa (self-serve)", () => {
  function build(options: { current?: any; tenantOwner?: any; tenantOwnerById?: any; institucional?: any } = {}) {
    const findUnique = jest.fn().mockImplementation(({ where }: any) => {
      if (where.gupshupAppName) return Promise.resolve(options.tenantOwner ?? null);
      if (where.gupshupAppId) return Promise.resolve(options.tenantOwnerById ?? null);
      return Promise.resolve(options.current ?? null);
    });
    const prisma: any = {
      messagingChannel: {
        findUnique,
        upsert: jest.fn().mockImplementation(({ create, update }: any) => Promise.resolve({
          id: "canal-1", companyId: "empresa-1", ...(options.current ? update : create),
        })),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...options.current, ...data })),
      },
      platformWhatsAppChannel: { findFirst: jest.fn().mockResolvedValue(options.institucional ?? null) },
      company: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ name: "Pizzaria do João" }),
      },
    };
    const mail = { sendOperationsAlert: jest.fn().mockResolvedValue(undefined) };
    const realtime = { emitToSuperAdmins: jest.fn(), emitToCompany: jest.fn() };
    const gupshup = { isEnabled: () => true, mode: () => "SELF_SERVE", getAppDetails: jest.fn() };
    const secrets = { isConfigured: () => true };
    const service = buildMessagingService({ prisma, mail, realtime, gupshup, secrets });
    return { service, prisma, mail, realtime, gupshup };
  }

  it("a empresa não tem rota para vincular aplicativo do Gupshup", () => {
    const controller = readFileSync(join(__dirname, "../src/messaging/messaging.controller.ts"), "utf8");
    expect(controller).not.toMatch(/@Put\("channel\/whatsapp\/gupshup"\)/);
    expect(controller).toMatch(/@Roles\(Role\.SUPER_ADMIN\)\s*@Put\("companies\/:companyId\/whatsapp\/gupshup"\)/);
  });

  it("recusa vincular o aplicativo do WhatsApp institucional a uma empresa", async () => {
    const { service, prisma } = build({ institucional: { id: "plataforma" } });
    await expect(service.connectGupshupManual("empresa-1", { appName: "chegowia", appId: "app-inst" } as never))
      .rejects.toThrow(/institucional/);
    expect(prisma.messagingChannel.upsert).not.toHaveBeenCalled();
  });

  it("recusa App ID que já pertence a outra empresa", async () => {
    const { service } = build({ tenantOwnerById: { companyId: "empresa-2" } });
    await expect(service.connectGupshupManual("empresa-1", { appName: "novoapp", appId: "app-2" } as never))
      .rejects.toThrow(/outra empresa/);
  });

  it("ativar com número exige o App ID", async () => {
    const { service } = build();
    await expect(service.connectGupshupManual("empresa-1", { appName: "pizzaria", number: "5562999990000" } as never))
      .rejects.toThrow(/App ID/);
  });

  it("ativar avisa o painel da empresa em tempo real", async () => {
    const { service, realtime } = build({ current: { id: "canal-1", status: "INATIVO", config: { gupshupSignupLink: "https://x" } } });
    (service as any).provisionOrderTemplateWithoutBlocking = jest.fn().mockResolvedValue({ connected: true });
    await service.connectGupshupManual("empresa-1", { appName: "pizzaria", appId: "app-1", number: "5562999990000" } as never);
    expect(realtime.emitToCompany).toHaveBeenCalledWith("empresa-1", "whatsapp.channel.updated", expect.objectContaining({ status: "ATIVO" }));
  });

  it("verificar status no self-serve não chama a Partner API", async () => {
    const { service, gupshup } = build({ current: { id: "canal-1", provider: "GUPSHUP", status: "INATIVO", gupshupAppId: "app-1", config: {} } });
    await expect(service.syncGupshupConnection("empresa-1")).resolves.toEqual(expect.objectContaining({ connected: false }));
    expect(gupshup.getAppDetails).not.toHaveBeenCalled();
  });

  it("'concluí o cadastro' registra o aviso e chama a equipe uma única vez", async () => {
    const atual = { id: "canal-1", provider: "GUPSHUP", status: "INATIVO", gupshupAppId: "app-1", config: { gupshupSignupLink: "https://x" } };
    const { service, prisma, mail, realtime } = build({ current: atual });
    const resumo = await service.markWhatsappSignupCompleted("empresa-1");
    expect(resumo.gupshup.signupCompletedAt).toEqual(expect.any(String));
    expect(mail.sendOperationsAlert).toHaveBeenCalledWith("WhatsApp pronto para ativar", expect.any(Array));
    expect(realtime.emitToSuperAdmins).toHaveBeenCalledWith("whatsapp.signup.completed", expect.anything());

    const repetido = build({ current: { ...atual, config: { ...atual.config, gupshupSignupCompletedAt: "2026-10-27T10:00:00Z" } } });
    await repetido.service.markWhatsappSignupCompleted("empresa-1");
    expect(repetido.mail.sendOperationsAlert).not.toHaveBeenCalled();
    expect(repetido.prisma.messagingChannel.update).not.toHaveBeenCalled();
    expect(prisma.messagingChannel.update).toHaveBeenCalled();
  });

  it("sem link de cadastro liberado, o aviso é recusado", async () => {
    const { service } = build({ current: { id: "canal-1", status: "INATIVO", config: {} } });
    await expect(service.markWhatsappSignupCompleted("empresa-1")).rejects.toThrow(/link de cadastro/);
  });
});
