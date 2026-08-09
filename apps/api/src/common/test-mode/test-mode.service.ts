import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Role } from "@prisma/client";
import { isIP } from "node:net";
import type { Request } from "express";
import { JwtPayload } from "../interfaces/jwt-payload.interface";
import { PRISMA_CLIENT } from "../prisma/prisma.constants";
import { ExtendedPrismaClient } from "../prisma/prisma-client.factory";

/**
 * Trava operacional temporária para homologar a plataforma em produção sem
 * abrir o cadastro ou o catálogo de teste para o público. Ela é desligada por
 * configuração, sem precisar publicar outro build para voltar ao fluxo normal.
 *
 * Em produção no Render, todo tráfego público passa pela borda Cloudflare.
 * Ela acrescenta `CF-Connecting-IP` com o endereço do visitante real; usar
 * apenas `request.ip` pode devolver o IP de um proxy interno e bloquear até o
 * próprio administrador. Em desenvolvimento, onde essa borda não existe,
 * mantemos o fallback para `request.ip` configurado pelo Express.
 */
@Injectable()
export class TemporaryTestModeService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  private db() {
    return this.prisma as any;
  }

  isEnabled() {
    return process.env.TEMP_TEST_MODE_ENABLED === "true";
  }

  /** O preço é propositalmente fixo e só existe enquanto a trava estiver ligada. */
  monthlyPriceOverride() {
    return this.isEnabled() ? 0.5 : null;
  }

  /** Empresas nascidas no modo de teste voltam a ser públicas ao desligá-lo. */
  shouldMarkNewCompanyAsTestOnly() {
    return this.isEnabled();
  }

  assertCreationAllowed(request: Request, resource: "empresa" | "revendedor") {
    if (!this.isEnabled()) return;

    const ip = clientIpFromTrustedEdge(request);
    if (ip && this.allowedCreationIps().has(ip)) return;

    throw new ForbiddenException(
      `O cadastro de ${resource} está temporariamente restrito ao ambiente de testes autorizado.`,
    );
  }

  /**
   * Filtro pronto para ser combinado em qualquer query pública de Company.
   * A conta autorizada é confirmada no banco; não confiamos apenas no e-mail
   * carregado no JWT, que pode permanecer válido por alguns minutos após uma
   * alteração administrativa de usuário.
   */
  async publicCompanyVisibilityWhere(viewer?: JwtPayload | null): Promise<Record<string, boolean>> {
    if (!this.isEnabled()) return {};
    return (await this.isCatalogViewerAuthorized(viewer)) ? {} : { isTestOnly: false };
  }

  /** Mesmo filtro para rotas que já receberam apenas o id da conta. */
  async publicCompanyVisibilityWhereForUserId(viewerId?: string | null): Promise<Record<string, boolean>> {
    if (!this.isEnabled()) return {};
    return (await this.isCatalogUserIdAuthorized(viewerId)) ? {} : { isTestOnly: false };
  }

  async isCatalogViewerAuthorized(viewer?: JwtPayload | null) {
    if (!this.isEnabled()) return true;
    if (!viewer || viewer.role !== Role.CLIENTE) return false;
    return this.isCatalogUserIdAuthorized(viewer.sub);
  }

  private async isCatalogUserIdAuthorized(viewerId?: string | null) {
    const email = normalizedConfiguredEmail();
    if (!viewerId || !email) return false;

    const user = await this.db().user.findFirst({
      where: {
        id: viewerId,
        email,
        role: Role.CLIENTE,
        isActive: true,
      },
      select: { id: true },
    });
    return Boolean(user);
  }

  private allowedCreationIps() {
    return new Set(
      (process.env.TEMP_TEST_ALLOWED_CREATION_IPS ?? "")
        .split(",")
        .map(normalizeIp)
        .filter(Boolean),
    );
  }
}

export function normalizeIp(value: string) {
  const withoutZone = value.trim().toLowerCase().split("%", 1)[0] ?? "";
  const normalized = withoutZone.startsWith("::ffff:")
    ? withoutZone.slice("::ffff:".length)
    : withoutZone;
  return isIP(normalized) ? normalized : "";
}

/**
 * Render encaminha todas as conexões públicas por Cloudflare. O header é
 * escrito pela borda, não pelo browser, e contém apenas um IP consistente.
 * Não usamos X-Forwarded-For manualmente: ele pode carregar uma cadeia criada
 * por proxies intermediários e não é apropriado para uma decisão de acesso.
 */
export function clientIpFromTrustedEdge(request: Pick<Request, "ip" | "headers">) {
  const cloudflareValue = request.headers?.["cf-connecting-ip"];
  const cloudflareIp = normalizeIp(
    Array.isArray(cloudflareValue) ? cloudflareValue[0] ?? "" : cloudflareValue ?? "",
  );
  return cloudflareIp || normalizeIp(request.ip ?? "");
}

function normalizedConfiguredEmail() {
  const value = process.env.TEMP_TEST_CATALOG_EMAIL?.trim().toLowerCase() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : "";
}
