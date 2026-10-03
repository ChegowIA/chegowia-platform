import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { DEFAULT_PERMISSIONS_BY_ROLE } from "@chegowia/shared";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { PermissionsService } from "../permissions/permissions.service";
import { CreateEmployeeDto } from "./dto/create-employee.dto";
import { UpdateEmployeeDto } from "./dto/update-employee.dto";
import { AuthService } from "../auth/auth.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { isReservedDemoEmail } from "../common/security/reserved-demo-account";

@Injectable()
export class EmployeesService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly permissionsService: PermissionsService,
    private readonly auth: AuthService,
    private readonly realtime: RealtimeGateway,
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
    const email = dto.email.trim().toLowerCase();
    if (isReservedDemoEmail(email)) {
      throw new BadRequestException("Este e-mail é reservado à operação interna de demonstração.");
    }
    const existing = await this.db().user.findUnique({ where: { email } });
    if (existing) throw new ConflictException("Já existe uma conta com este e-mail.");

    const user = await this.db().user.create({
      data: {
        name: dto.name,
        email,
        passwordHash: await bcrypt.hash(dto.password, 12),
        role: dto.role,
        companyId,
        employeeProfile: { create: { companyId, position: dto.position } },
      },
      include: { employeeProfile: true },
    });

    // A interface já envia o preset do papel, mas o backend também o aplica
    // quando um cliente de API não informa permissionKeys. Uma lista vazia é
    // respeitada: o administrador pode criar um acesso totalmente bloqueado e
    // liberar cada seção depois pela listagem de funcionários.
    const permissionKeys = dto.permissionKeys ?? DEFAULT_PERMISSIONS_BY_ROLE[dto.role] ?? [];
    await this.permissionsService.setForEmployee(user.employeeProfile.id, permissionKeys);
    await this.auth.sendVerificationForUser(user.id);
    return this.findById(user.employeeProfile.id);
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    const profile = await this.findById(id);
    const roleChanged = dto.role !== undefined && dto.role !== profile.user.role;

    const userUpdates: Record<string, unknown> = {};
    if (dto.name !== undefined) userUpdates.name = dto.name;
    if (dto.isActive !== undefined) userUpdates.isActive = dto.isActive;
    if (dto.role !== undefined) userUpdates.role = dto.role;
    if (Object.keys(userUpdates).length > 0) {
      await this.db().user.update({ where: { id: profile.user.id }, data: userUpdates });
    }
    if (dto.position !== undefined) {
      await this.db().employeeProfile.update({ where: { id }, data: { position: dto.position } });
    }
    // Desativar bloqueia o REST na requisição seguinte, mas o socket já
    // conectado seguiria recebendo os eventos da sala da empresa — com dados
    // pessoais dos clientes — até a aba ser fechada.
    if (dto.isActive === false) {
      this.realtime.disconnectUser(profile.user.id, "conta desativada");
    }
    if (roleChanged && dto.role) {
      // O cargo define uma base segura. Não deixamos permissões extras de um
      // papel anterior (por exemplo, caixa de um funcionário) escaparem para
      // um motoboy ou garçom. O administrador pode liberar exceções pela tela
      // específica logo depois.
      await this.permissionsService.setForEmployee(id, DEFAULT_PERMISSIONS_BY_ROLE[dto.role] ?? []);
      this.realtime.emitToUser(profile.user.id, "access.updated", { employeeProfileId: id });
    }
    return this.findById(id);
  }

  async setPermissions(id: string, permissionKeys: string[]) {
    const profile = await this.findById(id);
    const permissions = await this.permissionsService.setForEmployee(id, permissionKeys);
    // A pessoa não precisa sair e entrar novamente: o painel dela busca a nova
    // sessão quando recebe este evento, enquanto a API já aplica a alteração na
    // próxima requisição pelo PermissionsGuard.
    this.realtime.emitToUser(profile.user.id, "access.updated", { employeeProfileId: id });
    return permissions;
  }
}
