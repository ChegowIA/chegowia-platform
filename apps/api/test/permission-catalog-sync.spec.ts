import { PERMISSION_LABELS } from "@chegowia/shared";
import { PermissionsService } from "../src/permissions/permissions.service";

/**
 * O catálogo de permissões era gravado por um script de bootstrap rodado à mão
 * uma vez. Toda permissão criada depois nunca chegou ao banco, e a produção
 * ficou com 2 das 18 — sem erro nenhum, porque `setForEmployee` ignora em
 * silêncio a chave que não encontra. O acesso simplesmente não era concedido.
 */
describe("catálogo de permissões", () => {
  function servico(overrides: any = {}) {
    const prisma = {
      permission: {
        upsert: overrides.upsert ?? jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      rolePermission: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    };
    return { service: new PermissionsService(prisma as never), prisma };
  }

  it("grava no banco todas as permissões que o código conhece", async () => {
    const { service, prisma } = servico();

    await service.onModuleInit();

    const total = Object.keys(PERMISSION_LABELS).length;
    expect(prisma.permission.upsert).toHaveBeenCalledTimes(total);
    const chaves = prisma.permission.upsert.mock.calls.map((c: any) => c[0].where.key).sort();
    expect(chaves).toEqual(Object.keys(PERMISSION_LABELS).sort());
  });

  it("réplica que perde a corrida não derruba o boot", async () => {
    // Duas instâncias subindo juntas disputam a mesma linha; perder por chave
    // duplicada é resultado correto, não motivo para o processo morrer.
    const { service } = servico({
      upsert: jest.fn().mockRejectedValue(new Error("Unique constraint failed")),
    });

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it("conceder permissão que não existe no banco não concede nada — o motivo do bug", async () => {
    const { service, prisma } = servico();
    prisma.permission.findMany.mockResolvedValue([]);

    const resultado = await service.setForEmployee("perfil-1", ["caixa.operar"]);

    expect(resultado).toEqual([]);
    expect(prisma.rolePermission.createMany).not.toHaveBeenCalled();
  });
});
