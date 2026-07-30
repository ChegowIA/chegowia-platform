import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";

@Injectable()
export class UsersService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

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
    if (!String(file.mimetype ?? "").startsWith("image/")) {
      throw new BadRequestException("O arquivo precisa ser uma imagem.");
    }

    const uploadDir = join(process.cwd(), "uploads", "avatars");
    await mkdir(uploadDir, { recursive: true });

    const filename = `${userId}-${Date.now()}.${imageExtension(file.mimetype)}`;
    await writeFile(join(uploadDir, filename), file.buffer);

    return this.db().user.update({
      where: { id: userId },
      data: { avatarUrl: `/uploads/avatars/${filename}` },
      select: { id: true, name: true, email: true, role: true, companyId: true, avatarUrl: true },
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.db().user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException("Senha atual incorreta.");

    await this.db().user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 10) },
    });
    return { success: true };
  }
}

function imageExtension(mimetype: string): string {
  switch (mimetype) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/jpeg":
    case "image/jpg":
    default:
      return "jpg";
  }
}
