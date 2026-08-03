import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Role } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LocalStorageService } from "../common/storage/local-storage.service";

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly storage: LocalStorageService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private db() {
    return this.prisma as any;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.db().user.update({
      where: { id: userId },
      data: dto,
      select: { id: true, name: true, email: true, role: true, companyId: true, avatarUrl: true },
    });
  }

  async uploadAvatar(userId: string, file: any) {
    if (!file) throw new BadRequestException("Envie uma imagem para o perfil.");
    const current = await this.db().user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });
    const avatarUrl = await this.storage.savePublicImage(file, "avatars", userId);

    let user: any;
    try {
      user = await this.db().user.update({
        where: { id: userId },
        data: { avatarUrl },
        select: { id: true, name: true, email: true, role: true, companyId: true, avatarUrl: true },
      });
    } catch (error) {
      await this.storage.removePublicUrl(avatarUrl);
      throw error;
    }
    await this.storage.removePublicUrl(current?.avatarUrl);
    return user;
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.db().user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException("Senha atual incorreta.");

    await this.db().$transaction([
      this.db().user.update({
        where: { id: userId },
        data: { passwordHash: await bcrypt.hash(dto.newPassword, 12) },
      }),
      this.db().refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.db().accountToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);
    // Trocar a senha revogava o refresh token mas deixava o socket aberto: no
    // cenário "minha conta foi invadida", o invasor continuava recebendo os
    // eventos ao vivo. Derrubar a conexão fecha esse caminho.
    this.realtime.disconnectUser(userId, "senha alterada");
    return { success: true };
  }

  async exportMyData(userId: string) {
    const user = await this.db().user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        document: true,
        role: true,
        avatarUrl: true,
        isActive: true,
        emailVerifiedAt: true,
        termsAcceptedAt: true,
        privacyAcceptedAt: true,
        companyId: true,
        createdAt: true,
        updatedAt: true,
        addresses: true,
        employeeProfile: {
          select: { id: true, position: true, createdAt: true },
        },
        resellerProfile: {
          select: {
            id: true,
            code: true,
            commissionRate: true,
            stripeOnboardingOk: true,
            approvedAt: true,
            createdAt: true,
          },
        },
        ordersAsCustomer: {
          select: {
            id: true,
            companyId: true,
            status: true,
            paymentStatus: true,
            paymentMethod: true,
            subtotal: true,
            deliveryFee: true,
            total: true,
            deliveryStreet: true,
            deliveryNumber: true,
            deliveryComplement: true,
            deliveryNeighborhood: true,
            deliveryCity: true,
            deliveryState: true,
            createdAt: true,
            updatedAt: true,
            items: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!user) throw new UnauthorizedException();
    return {
      generatedAt: new Date(),
      controllerContact: "contato@chegowia.com.br",
      data: user,
    };
  }

  /**
   * Exclusão da conta pelo titular (LGPD art. 18, VI).
   *
   * **Anonimiza em vez de apagar.** Um pedido é documento fiscal e contábil: a
   * lei obriga a guarda por cinco anos, e apagar a linha destruiria o histórico
   * de vendas do restaurante junto com o dado pessoal. O que se apaga é o
   * vínculo com a pessoa — nome, e-mail, documento, endereços, telefone — e o
   * pedido permanece com o valor e os itens, sem dono identificável.
   *
   * Só para CLIENTE. Quem tem vínculo com empresa (ADMIN, funcionário,
   * revendedor) precisa passar pelo desligamento, senão a exclusão viraria uma
   * forma de sumir com responsabilidade contratual.
   */
  async deleteMyAccount(userId: string, password: string) {
    const user = await this.db().user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (user.role !== Role.CLIENTE) {
      throw new BadRequestException(
        "Contas vinculadas a uma empresa são encerradas pelo administrador, não por aqui.",
      );
    }
    // Exigir a senha impede que uma sessão sequestrada apague a conta da
    // vítima — e a exclusão é irreversível.
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      throw new BadRequestException("Senha incorreta.");
    }

    const marcador = `anonimizado-${randomBytes(8).toString("hex")}`;
    await this.db().$transaction([
      this.db().address.deleteMany({ where: { userId } }),
      this.db().refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.db().accountToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
      // O endereço de entrega fica no próprio pedido; anonimizar aqui evita
      // reconstruir a identidade a partir do histórico.
      this.db().order.updateMany({
        where: { customerId: userId },
        data: {
          deliveryStreet: "Removido a pedido do titular",
          deliveryNumber: "0",
          deliveryComplement: null,
          deliveryNeighborhood: "Removido",
          deliveryReference: null,
        },
      }),
      this.db().user.update({
        where: { id: userId },
        data: {
          name: "Cliente removido",
          email: `${marcador}@removido.local`,
          document: null,
          avatarUrl: null,
          passwordHash: randomBytes(32).toString("hex"),
          isActive: false,
        },
      }),
    ]);

    this.realtime.disconnectUser(userId, "conta encerrada a pedido do titular");
    this.logger.log(`Conta ${userId} anonimizada a pedido do titular.`);
    return {
      success: true,
      message: "Sua conta foi encerrada e seus dados pessoais foram removidos. "
        + "Os pedidos permanecem sem identificação por exigência fiscal.",
    };
  }
}
