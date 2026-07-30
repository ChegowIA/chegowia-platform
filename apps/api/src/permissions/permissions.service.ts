import { Inject, Injectable } from "@nestjs/common";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";

@Injectable()
export class PermissionsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  private db() {
    return this.prisma as any;
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
