import { BadRequestException } from "@nestjs/common";
import { PermissionKey, PERMISSION_LABELS } from "@chegowia/shared";
import { buildMessagingService, buildPlatformWhatsAppService } from "./support/messaging-services";

/**
 * Atendimento por WhatsApp com permissão própria.
 *
 * Era amarrado às permissões de pedido: quem podia ver pedido lia todas as
 * conversas dos clientes — telefone, endereço, o que a pessoa escreveu — e não
 * havia como dar o inbox a um atendente sem dar pedidos junto.
 */
describe("permissão de atendimento", () => {
  it("existe no catálogo, com rótulo", () => {
    // Chave sem rótulo não aparece na tela de permissões do funcionário, e
    // `setForEmployee` ignora em silêncio a chave que não encontra.
    expect(PERMISSION_LABELS[PermissionKey.ATENDIMENTO_VISUALIZAR]).toBeTruthy();
    expect(PERMISSION_LABELS[PermissionKey.ATENDIMENTO_RESPONDER]).toBeTruthy();
  });

  it("é separada das permissões de pedido", () => {
    expect(PermissionKey.ATENDIMENTO_VISUALIZAR).not.toBe(PermissionKey.PEDIDOS_VISUALIZAR);
    expect(PermissionKey.ATENDIMENTO_RESPONDER).not.toBe(PermissionKey.PEDIDOS_EDITAR);
  });
});

/**
 * Apagar a conversa é diferente de limpar o histórico.
 *
 * Limpar esvazia as mensagens e mantém o contato na lista, para reiniciar o
 * atendimento. Apagar tira a conversa da tela. A recusa quando existe pedido não
 * é capricho: o banco protege esse vínculo com `Restrict`, e sem a checagem o
 * apagar falharia com erro de chave estrangeira, que não diz nada a quem clicou.
 */
describe("apagar conversa da empresa", () => {
  function construir(pedidos: number) {
    const tx = {
      whatsAppOrderDraft: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      whatsAppMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 4 }) },
      whatsAppConversation: { delete: jest.fn().mockResolvedValue({ id: "conv-1" }) },
    };
    const prisma: any = {
      order: { count: jest.fn().mockResolvedValue(pedidos) },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    };
    const service = buildMessagingService({
      prisma,
      realtime: { emitToCompany: jest.fn() },
    }) as any;
    service.getWhatsAppConversation = jest.fn().mockResolvedValue({ id: "conv-1", companyId: "emp-1" });
    return { service, prisma, tx };
  }

  it("apaga mensagens, rascunho e a conversa", async () => {
    const { service, tx } = construir(0);

    const resultado = await service.deleteWhatsAppConversation("emp-1", "conv-1");

    expect(tx.whatsAppMessage.deleteMany).toHaveBeenCalled();
    // Rascunho em aberto sem conversa faria o assistente responder a um
    // atendimento que não existe mais.
    expect(tx.whatsAppOrderDraft.deleteMany).toHaveBeenCalled();
    expect(tx.whatsAppConversation.delete).toHaveBeenCalled();
    expect(resultado).toEqual({ id: "conv-1", deleted: true });
  });

  it("conversa que gerou pedido é recusada, com o caminho alternativo na mensagem", async () => {
    const { service, tx } = construir(2);

    await expect(service.deleteWhatsAppConversation("emp-1", "conv-1")).rejects.toThrow(BadRequestException);
    await expect(service.deleteWhatsAppConversation("emp-1", "conv-1")).rejects.toThrow(/2 pedidos.*Limpar histórico/s);
    expect(tx.whatsAppConversation.delete).not.toHaveBeenCalled();
  });

  it("um pedido só: a mensagem fala no singular", async () => {
    const { service } = construir(1);

    await expect(service.deleteWhatsAppConversation("emp-1", "conv-1")).rejects.toThrow(/um pedido/);
  });
});

describe("apagar conversa institucional", () => {
  it("apaga mensagens e conversa, e avisa a tela", async () => {
    const tx = {
      platformWhatsAppMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      platformWhatsAppConversation: { delete: jest.fn().mockResolvedValue({ id: "conv-1" }) },
    };
    const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    const realtime = { emitToSuperAdmins: jest.fn() };
    const service = buildPlatformWhatsAppService({ prisma, realtime }) as any;
    service.getConversation = jest.fn().mockResolvedValue({ id: "conv-1" });

    const resultado = await service.deleteConversation("conv-1");

    expect(tx.platformWhatsAppMessage.deleteMany).toHaveBeenCalled();
    expect(tx.platformWhatsAppConversation.delete).toHaveBeenCalled();
    expect(realtime.emitToSuperAdmins).toHaveBeenCalled();
    expect(resultado).toEqual({ id: "conv-1", deleted: true });
  });
});
