import { RealtimeGateway } from "../src/realtime/realtime.gateway";
import { EmployeesService } from "../src/employees/employees.service";
import { UsersService } from "../src/users/users.service";
import { DEFAULT_PERMISSIONS_BY_ROLE, Role } from "@chegowia/shared";

/**
 * O socket é autorizado uma única vez, no handshake. Quando o vínculo muda, a
 * conexão precisa ser encerrada — senão a pessoa segue recebendo os eventos da
 * sala da empresa, que carregam dados pessoais dos clientes.
 */
describe("revogação de sessão em tempo real", () => {
  function gatewayWithServer() {
    const disconnectSockets = jest.fn();
    const emit = jest.fn();
    const server = {
      to: jest.fn().mockReturnValue({ emit }),
      in: jest.fn().mockReturnValue({ disconnectSockets }),
    };
    const gateway = new RealtimeGateway({} as never, {} as never);
    (gateway as any).server = server;
    return { gateway, server, emit, disconnectSockets };
  }

  it("encerra as conexões da sala do usuário e avisa o motivo", () => {
    const { gateway, server, emit, disconnectSockets } = gatewayWithServer();

    gateway.disconnectUser("user-1", "conta desativada");

    expect(server.to).toHaveBeenCalledWith("user:user-1");
    expect(emit).toHaveBeenCalledWith("session.revoked", { reason: "conta desativada" });
    expect(server.in).toHaveBeenCalledWith("user:user-1");
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });

  it("não quebra quando o gateway ainda não subiu", () => {
    const gateway = new RealtimeGateway({} as never, {} as never);
    expect(() => gateway.disconnectUser("user-1")).not.toThrow();
  });

  it("desativar funcionário derruba o socket dele", async () => {
    const realtime = { disconnectUser: jest.fn(), emitToUser: jest.fn() };
    const prisma = {
      employeeProfile: {
        findUnique: jest.fn().mockResolvedValue({ id: "perfil-1", user: { id: "user-1" } }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
    };
    const service = new EmployeesService(prisma as never, {} as never, {} as never, realtime as never);
    (service as any).findById = jest.fn().mockResolvedValue({ id: "perfil-1", user: { id: "user-1" } });

    await service.update("perfil-1", { isActive: false } as never);

    expect(realtime.disconnectUser).toHaveBeenCalledWith("user-1", "conta desativada");
  });

  it("não derruba o socket ao apenas renomear o funcionário", async () => {
    const realtime = { disconnectUser: jest.fn(), emitToUser: jest.fn() };
    const prisma = { user: { update: jest.fn().mockResolvedValue({}) }, employeeProfile: { update: jest.fn() } };
    const service = new EmployeesService(prisma as never, {} as never, {} as never, realtime as never);
    (service as any).findById = jest.fn().mockResolvedValue({ id: "perfil-1", user: { id: "user-1" } });

    await service.update("perfil-1", { name: "Novo Nome" } as never);

    expect(realtime.disconnectUser).not.toHaveBeenCalled();
  });

  it("trocar o cargo aplica somente o preset de acessos do novo cargo", async () => {
    const realtime = { disconnectUser: jest.fn(), emitToUser: jest.fn() };
    const permissions = { setForEmployee: jest.fn().mockResolvedValue([]) };
    const prisma = { user: { update: jest.fn().mockResolvedValue({}) }, employeeProfile: { update: jest.fn() } };
    const service = new EmployeesService(prisma as never, permissions as never, {} as never, realtime as never);
    (service as any).findById = jest.fn().mockResolvedValue({
      id: "perfil-1",
      user: { id: "user-1", role: Role.MOTOBOY },
    });

    await service.update("perfil-1", { role: Role.GARCOM } as never);

    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: Role.GARCOM }),
    }));
    expect(permissions.setForEmployee).toHaveBeenCalledWith("perfil-1", DEFAULT_PERMISSIONS_BY_ROLE[Role.GARCOM]);
    expect(realtime.emitToUser).toHaveBeenCalledWith("user-1", "access.updated", { employeeProfileId: "perfil-1" });
  });

  it("trocar a senha corta o stream ao vivo da credencial antiga", async () => {
    const realtime = { disconnectUser: jest.fn() };
    const bcrypt = require("bcrypt");
    const hash = await bcrypt.hash("SenhaAtual@1", 4);
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: "user-1", passwordHash: hash }), update: jest.fn() },
      refreshToken: { updateMany: jest.fn() },
      accountToken: { updateMany: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const service = new UsersService(prisma as never, {} as never, realtime as never);

    await service.changePassword("user-1", { currentPassword: "SenhaAtual@1", newPassword: "SenhaNova@123" } as never);

    expect(realtime.disconnectUser).toHaveBeenCalledWith("user-1", "senha alterada");
  });
});
