import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { PermissionsService } from "../permissions/permissions.service";
import { CreateEmployeeDto } from "./dto/create-employee.dto";
import { UpdateEmployeeDto } from "./dto/update-employee.dto";

@Injectable()
export class EmployeesService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly permissionsService: PermissionsService,
  ) {}

  private db() {
    return this.prisma as any;
  }

  // EmployeeProfile é tenant-scoped pelo Prisma extension: list()/findById() já
  // retornam só funcionários da empresa do usuário logado.
  list() {
    return this.db().employeeProfile.findMany({
      include: {
        user: { select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true } },
        rolePermissions: { include: { permission: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(id: string) {
    const profile = await this.db().employeeProfile.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true } },
        rolePermissions: { include: { permission: true } },
      },
    });
    if (!profile) throw new NotFoundException("Funcionário não encontrado.");
    return profile;
  }

  async create(companyId: string, dto: CreateEmployeeDto) {
    const existing = await this.db().user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException("Já existe uma conta com este e-mail.");

    const user = await this.db().user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, 10),
        role: dto.role,
        companyId,
        employeeProfile: { create: { companyId, position: dto.position } },
      },
      include: { employeeProfile: true },
    });

    if (dto.permissionKeys?.length) {
      await this.permissionsService.setForEmployee(user.employeeProfile.id, dto.permissionKeys);
    }
    return this.findById(user.employeeProfile.id);
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    const profile = await this.findById(id);

    const userUpdates: Record<string, unknown> = {};
    if (dto.name !== undefined) userUpdates.name = dto.name;
    if (dto.isActive !== undefined) userUpdates.isActive = dto.isActive;
    if (Object.keys(userUpdates).length > 0) {
      await this.db().user.update({ where: { id: profile.user.id }, data: userUpdates });
    }
    if (dto.position !== undefined) {
      await this.db().employeeProfile.update({ where: { id }, data: { position: dto.position } });
    }
    return this.findById(id);
  }

  async setPermissions(id: string, permissionKeys: string[]) {
    await this.findById(id);
    return this.permissionsService.setForEmployee(id, permissionKeys);
  }
}
