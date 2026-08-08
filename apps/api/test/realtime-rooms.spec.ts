import { Role, SubscriptionStatus } from "@prisma/client";
import { PermissionKey } from "@chegowia/shared";
import { RealtimeGateway } from "../src/realtime/realtime.gateway";

/**
 * A sala da empresa era única: quem conectava recebia tudo — pedido completo com
 * dados do cliente, conversa de WhatsApp, entrega — mesmo sem a permissão REST
 * correspondente. As salas agora são por tópico e escolhidas no handshake.
 */
describe("salas de tempo real por tópico", () => {
  function gateway(permissionKeys: string[]) {
    const prisma = {
      employeeProfile: {
        findFirst: jest.fn().mockResolvedValue({
          rolePermissions: permissionKeys.map((key) => ({ permission: { key } })),
        }),
      },
    };
    return new RealtimeGateway({} as never, prisma as never);
  }

  const payload = (role: Role) => ({ sub: "user-1", role, companyId: "empresa-1" }) as never;

  it("administrador entra em todos os tópicos sem consultar permissões", async () => {
    const instance = gateway([]);
    const topics = await (instance as any).allowedTopics(payload(Role.ADMIN));
    expect(topics.sort()).toEqual(["atendimento", "entregas", "mesas", "pedidos"]);
  });

  it("motoboy só entra em entregas — nada de atendimento nem pedidos", async () => {
    const instance = gateway([PermissionKey.ENTREGAS_VISUALIZAR, PermissionKey.ENTREGAS_EDITAR]);
    const topics = await (instance as any).allowedTopics(payload(Role.MOTOBOY));
    expect(topics).toEqual(["entregas"]);
  });

  it("garçom sem permissão de pedidos não escuta conversas de WhatsApp", async () => {
    const instance = gateway([PermissionKey.MESAS_VISUALIZAR]);
    const topics = await (instance as any).allowedTopics(payload(Role.GARCOM));
    expect(topics).toEqual(["mesas"]);
    expect(topics).not.toContain("atendimento");
  });

  it("funcionário sem perfil de permissões não entra em sala nenhuma", async () => {
    const instance = new RealtimeGateway(
      {} as never,
      { employeeProfile: { findFirst: jest.fn().mockResolvedValue(null) } } as never,
    );
    const topics = await (instance as any).allowedTopics(payload(Role.FUNCIONARIO));
    expect(topics).toEqual([]);
  });

  describe("roteamento do evento para o tópico", () => {
    function gatewayComServidor() {
      const emit = jest.fn();
      const server = { to: jest.fn().mockReturnValue({ emit }) };
      const instance = new RealtimeGateway({} as never, {} as never);
      (instance as any).server = server;
      return { instance, server, emit };
    }

    it.each([
      ["order.created", "company:empresa-1:pedidos"],
      ["delivery.location_updated", "company:empresa-1:entregas"],
      ["table.order_created", "company:empresa-1:mesas"],
      ["table.attendant_assigned", "company:empresa-1:mesas"],
      ["whatsapp.message.received", "company:empresa-1:atendimento"],
    ])("%s vai para %s", (event, room) => {
      const { instance, server, emit } = gatewayComServidor();
      instance.emitToCompany("empresa-1", event, { ok: true });
      expect(server.to).toHaveBeenCalledWith(room);
      expect(emit).toHaveBeenCalledWith(event, { ok: true });
    });

    it("evento com prefixo desconhecido não é entregue a ninguém", () => {
      const { instance, server } = gatewayComServidor();
      instance.emitToCompany("empresa-1", "financeiro.fechado", {});
      expect(server.to).not.toHaveBeenCalled();
    });
  });
});

/**
 * O socket é autorizado uma vez, no handshake. Um tablet de salão aberto o dia
 * todo seguia conectado com a credencial daquele instante.
 */
describe("revalidação periódica do socket", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function socketFake() {
    const handlers: Record<string, () => void> = {};
    return {
      data: { user: { sub: "user-1", role: Role.GARCOM, companyId: "empresa-1" } },
      emit: jest.fn(),
      disconnect: jest.fn(),
      on: jest.fn((event: string, handler: () => void) => {
        handlers[event] = handler;
      }),
      handlers,
    };
  }

  function instanceWith(user: unknown) {
    const validCompanyUser = {
      emailVerifiedAt: new Date(),
      company: {
        isActive: true,
        subscription: { status: SubscriptionStatus.ATIVA, trialEndsAt: null },
      },
      ...(user as object),
    };
    return new RealtimeGateway(
      {} as never,
      { user: { findUnique: jest.fn().mockResolvedValue(validCompanyUser) } } as never,
    );
  }

  it("mantém a conexão enquanto o vínculo continua o mesmo", async () => {
    const client = socketFake();
    const instance = instanceWith({ isActive: true, role: Role.GARCOM, companyId: "empresa-1" });
    (instance as any).scheduleRevalidation(client);

    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it("derruba quando a conta é desativada fora dos caminhos instrumentados", async () => {
    const client = socketFake();
    const instance = instanceWith({ isActive: false, role: Role.GARCOM, companyId: "empresa-1" });
    (instance as any).scheduleRevalidation(client);

    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(client.emit).toHaveBeenCalledWith("session.revoked", expect.anything());
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it("derruba quando o papel muda depois da conexão", async () => {
    const client = socketFake();
    const instance = instanceWith({ isActive: true, role: Role.COZINHA, companyId: "empresa-1" });
    (instance as any).scheduleRevalidation(client);

    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it("para o timer quando o socket cai, para não vazar intervalo", async () => {
    const client = socketFake();
    const instance = instanceWith({ isActive: true, role: Role.GARCOM, companyId: "empresa-1" });
    (instance as any).scheduleRevalidation(client);

    client.handlers.disconnect();
    await jest.advanceTimersByTimeAsync(30 * 60 * 1000);

    expect(client.disconnect).not.toHaveBeenCalled();
  });
});
