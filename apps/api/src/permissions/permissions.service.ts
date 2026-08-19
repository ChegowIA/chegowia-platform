import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { PERMISSION_LABELS } from "@chegowia/shared";

@Injectable()
export class PermissionsService implements OnModuleInit {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  private db() {
    return this.prisma as any;
  }

  /**
   * Sincroniza o catálogo de permissões com o código a cada boot.
   *
   * O catálogo nasce de `PERMISSION_LABELS`, mas quem o gravava no banco era um
   * script de bootstrap executado à mão uma única vez. Toda permissão criada
   * depois disso nunca chegou ao banco — e `setForEmployee` ignora em silêncio a
   * chave que não encontra, então conceder um acesso inexistente não dá erro:
   * simplesmente não concede. Foi assim que a produção ficou com 2 das 18.
   *
   * O upsert é idempotente e barato, e vale em toda réplica: duas subindo juntas
   * disputam a mesma linha e uma perde por chave duplicada, que é resultado
   * correto e não pode derrubar o boot.
   */
  async onModuleInit() {
    const catalogo = Object.entries(PERMISSION_LABELS);
    let gravadas = 0;
    for (const [key, description] of catalogo) {
      try {
        await this.db().permission.upsert({
          where: { key },
          update: { description },
          create: { key, description },
        });
        gravadas += 1;
      } catch (error) {
        this.logger.warn(`Não foi possível sincronizar a permissão ${key}.`, error as never);
      }
    }
    this.logger.log(`Catálogo de permissões sincronizado: ${gravadas} de ${catalogo.length}.`);
  }

  /** Catálogo fixo de permissões disponíveis na plataforma (ver packages/shared PermissionKey). */
  listCatalog() {
    return this.db().permission.findMany({ orderBy: { key: "asc" } });
  }

  async setForEmployee(employeeProfileId: string, permissionKeys: string[]) {
    const permissions = await this.db().permission.findMany({ where: { key: { in: permissionKeys } } });

    await this.db().rolePermission.deleteMany({ where: { employeeProfileId } });
    if (permissions.length === 0) return [];

    await this.db().rolePermission.createMany({
      data: permissions.map((p: any) => ({ employeeProfileId, permissionId: p.id })),
    });
    return this.getForEmployee(employeeProfileId);
  }

  getForEmployee(employeeProfileId: string) {
    return this.db().rolePermission.findMany({
      where: { employeeProfileId },
      include: { permission: true },
    });
  }
}
