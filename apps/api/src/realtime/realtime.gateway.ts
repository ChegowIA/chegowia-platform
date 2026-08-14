import { Inject, Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { Role, SubscriptionStatus } from "@prisma/client";
import { PermissionKey } from "@chegowia/shared";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";

/**
 * Tópicos da sala da empresa e a permissão que os libera. As salas eram uma só
 * (`company:{id}`), então qualquer papel conectado recebia tudo — inclusive
 * conversas de WhatsApp e o pedido completo com dados do cliente, sem ter a
 * permissão REST correspondente.
 */
const TOPIC_PERMISSION = {
  pedidos: PermissionKey.PEDIDOS_VISUALIZAR,
  entregas: PermissionKey.ENTREGAS_VISUALIZAR,
  mesas: PermissionKey.MESAS_VISUALIZAR,
  atendimento: PermissionKey.PEDIDOS_VISUALIZAR,
} as const;

type RealtimeTopic = keyof typeof TOPIC_PERMISSION;

/** Prefixo do evento → tópico. Mantenha sincronizado com quem emite. */
const EVENT_TOPIC: Record<string, RealtimeTopic> = {
  order: "pedidos",
  delivery: "entregas",
  table: "mesas",
  whatsapp: "atendimento",
};

/** De quanto em quanto tempo cada socket é reconferido contra o banco. */
const REVALIDATION_INTERVAL_MS = 5 * 60 * 1000;

const COMPANY_ROLES = new Set<Role>([
  Role.ADMIN,
  Role.FUNCIONARIO,
  Role.COZINHA,
  Role.MOTOBOY,
  Role.GARCOM,
]);

function isTrialActive(subscription: { status?: SubscriptionStatus; trialEndsAt?: Date | null } | null | undefined) {
  return subscription?.status === SubscriptionStatus.EM_TESTE
    && Boolean(subscription.trialEndsAt && subscription.trialEndsAt.getTime() > Date.now());
}

function isTrialExpired(subscription: { status?: SubscriptionStatus; trialEndsAt?: Date | null } | null | undefined) {
  return subscription?.status === SubscriptionStatus.EM_TESTE
    && Boolean(subscription.trialEndsAt && subscription.trialEndsAt.getTime() <= Date.now());
}

function subscriptionAllowsAccess(subscription: { status?: SubscriptionStatus; trialEndsAt?: Date | null } | null | undefined) {
  return subscription?.status === SubscriptionStatus.ATIVA || isTrialActive(subscription);
}

/**
 * Um socket por usuário logado no painel. Cada conexão entra na sala pessoal
 * (`user:{id}`) e nas salas de tópico da empresa que a permissão dela autoriza
 * (`company:{id}:pedidos`, `:entregas`, `:mesas`, `:atendimento`), para receber
 * atualizações em tempo real sem polling.
 *
 * Autenticação via `handshake.auth.token` (mesmo access token do REST), com
 * revalidação periódica contra o banco e expulsão imediata quando o vínculo
 * muda (ver `disconnectUser`).
 */
@Injectable()
@WebSocketGateway({
  namespace: "/realtime",
  cors: {
    origin: process.env.CORS_ORIGIN?.split(",").map((value) => value.trim())
      ?? ["http://localhost:3000"],
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server | null = null;

  private readonly logger = new Logger("RealtimeGateway");

  constructor(
    private readonly jwtService: JwtService,
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error("Token de acesso ausente.");
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      const session = await this.resolveSocketSession(payload);
      if (!session) throw new Error("Conta inativa.");
      const companyRole = COMPANY_ROLES.has(payload.role);
      const billingAllowed = this.billingAllowsCompanyRealtime(session.company?.subscription, companyRole);
      const socketData = client.data as { user: JwtPayload; companyAccessPaused?: boolean };
      socketData.user = payload;
      socketData.companyAccessPaused = companyRole && Boolean(payload.companyId) && !billingAllowed;
      // A sala pessoal não contém eventos da empresa. Mantê-la ativa quando a
      // assinatura expira permite que a pessoa continue recebendo a Central de
      // Suporte, sem devolver acesso em tempo real a pedidos, clientes ou
      // conversas da empresa.
      client.join(this.userRoom(payload.sub));
      if (payload.companyId && billingAllowed) {
        for (const topic of await this.allowedTopics(payload)) {
          client.join(this.topicRoom(payload.companyId, topic));
        }
      }
      // O inbox institucional não pertence a uma empresa. Só SUPER_ADMIN entra
      // nesta sala, que jamais usa os tópicos company:{id}:*.
      if (payload.role === Role.SUPER_ADMIN) client.join("super-admins");
      // A visão de um parceiro específico não participa da sala coletiva:
      // suporte não deve receber oportunidades de outros revendedores nem
      // disputar um lead enquanto investiga dados de uma conta real.
      if (payload.role === Role.REVENDEDOR && !payload.assumed && !session.resellerSupport) client.join("resellers");
      // O handshake é a única autorização do socket; sem prazo, um tablet de
      // salão aberto o dia todo seguiria conectado com credencial vencida.
      this.scheduleRevalidation(client);
    } catch {
      this.logger.warn(`Conexão websocket rejeitada: ${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect() {
    // socket.io já remove o client das salas automaticamente.
  }

  /**
   * Descobre a quais tópicos o socket pode ouvir. ADMIN e SUPER_ADMIN ouvem
   * tudo; os demais só recebem o que a permissão granular deles autoriza no
   * REST — antes, um MOTOBOY conectado recebia `whatsapp.message.received` e o
   * `order.created` completo, com os dados do cliente.
   */
  private async allowedTopics(payload: JwtPayload): Promise<RealtimeTopic[]> {
    const todos = Object.keys(TOPIC_PERMISSION) as RealtimeTopic[];
    if (payload.role === Role.ADMIN || payload.role === Role.SUPER_ADMIN) return todos;

    const profile = await (this.prisma as any).employeeProfile.findFirst({
      where: { userId: payload.sub },
      select: { rolePermissions: { select: { permission: { select: { key: true } } } } },
    });
    const chaves = new Set<string>(
      (profile?.rolePermissions ?? []).map((item: any) => item.permission.key),
    );
    return todos.filter((topic) => chaves.has(TOPIC_PERMISSION[topic]));
  }

  /**
   * Revalida a conexão periodicamente. `disconnectUser` cobre as mudanças que o
   * servidor provoca; isto cobre a expiração passiva e qualquer alteração feita
   * fora dos caminhos instrumentados.
   */
  private scheduleRevalidation(client: Socket) {
    const timer = setInterval(async () => {
      const socketData = client.data as { user?: JwtPayload; companyAccessPaused?: boolean };
      const payload = socketData.user;
      if (!payload) return;
      const session = await this.resolveSocketSession(payload).catch(() => null);
      const companyRole = COMPANY_ROLES.has(payload.role);
      const billingAllowed = this.billingAllowsCompanyRealtime(session?.company?.subscription, companyRole);
      if (!session) {
        client.emit("session.revoked", { reason: "acesso revalidado e negado" });
        client.disconnect(true);
        return;
      }

      if (companyRole && payload.companyId && !billingAllowed) {
        // Expirou enquanto o painel estava aberto: remove só as salas de
        // negócio. A sala user:{id} segue aberta exclusivamente para suporte.
        for (const topic of Object.keys(TOPIC_PERMISSION) as RealtimeTopic[]) {
          client.leave(this.topicRoom(payload.companyId, topic));
        }
        socketData.companyAccessPaused = true;
        client.emit("company.access.paused", { reason: "assinatura inativa" });
        return;
      }

      if (companyRole && payload.companyId && billingAllowed && socketData.companyAccessPaused) {
        // Caso o pagamento seja regularizado sem o usuário atualizar a página,
        // as permissões de tópico são restauradas na próxima revalidação.
        for (const topic of await this.allowedTopics(payload)) {
          client.join(this.topicRoom(payload.companyId, topic));
        }
        socketData.companyAccessPaused = false;
      }
    }, REVALIDATION_INTERVAL_MS);
    timer.unref?.();
    client.on("disconnect", () => clearInterval(timer));
  }

  /**
   * REST e websocket precisam interpretar da mesma forma uma sessão assumida.
   * Em especial, `sub` continua sendo o superadmin, portanto compará-lo ao
   * papel assumido bloquearia o suporte — ou, pior, faria o socket entrar em
   * salas erradas. A origem é revalidada no banco no handshake e a cada ciclo.
   */
  private async resolveSocketSession(payload: JwtPayload): Promise<{
    company: { isActive: boolean; subscription: { status: SubscriptionStatus; trialEndsAt: Date | null } | null } | null;
    resellerSupport: boolean;
  } | null> {
    const db = this.prisma as any;
    const user = await db.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        isActive: true,
        role: true,
        email: true,
        companyId: true,
        emailVerifiedAt: true,
        company: {
          select: {
            isActive: true,
            subscription: { select: { status: true, trialEndsAt: true } },
          },
        },
        resellerProfile: { select: { isActive: true } },
      },
    }).catch(() => null);
    if (!user?.isActive || !user.emailVerifiedAt) return null;

    if (!payload.assumed) {
      if (user.role !== payload.role || user.companyId !== payload.companyId) return null;
      if (payload.role === Role.REVENDEDOR && !user.resellerProfile?.isActive) return null;
      if (COMPANY_ROLES.has(payload.role) && !user.company?.isActive) return null;
      return { company: user.company ?? null, resellerSupport: false };
    }

    const allowedEmail = (process.env.MULTI_CONTEXT_LOGIN_EMAIL ?? "").trim().toLowerCase();
    if (
      user.role !== Role.SUPER_ADMIN
      || !allowedEmail
      || user.email.trim().toLowerCase() !== allowedEmail
    ) return null;

    // Contextos manuais existentes seguem válidos; eles não ganham nenhuma das
    // exceções de suporte e ainda exigem que a empresa alvo esteja ativa.
    if (!payload.assumedAccessId) {
      const company = payload.companyId
        ? await db.company?.findUnique?.({
            where: { id: payload.companyId },
            select: { isActive: true, subscription: { select: { status: true, trialEndsAt: true } } },
          }).catch(() => null)
        : null;
      if (COMPANY_ROLES.has(payload.role) && !company?.isActive) return null;
      return { company, resellerSupport: false };
    }

    if ((payload.assumedAccessKind ?? "COMPANY") === "COMPANY") {
      if (payload.role !== Role.ADMIN || !payload.companyId) return null;
      const access = await db.superAdminCompanyAccess?.findFirst?.({
        where: {
          id: payload.assumedAccessId,
          superAdminId: user.id,
          companyId: payload.companyId,
          consumedAt: { not: null },
          revokedAt: null,
          closedAt: null,
          sessionExpiresAt: { gt: new Date() },
        },
        select: {
          id: true,
          company: { select: { isActive: true, subscription: { select: { status: true, trialEndsAt: true } } } },
        },
      });
      return access?.company ? { company: access.company, resellerSupport: false } : null;
    }

    if ((payload.assumedAccessKind ?? "COMPANY") === "RESELLER") {
      if (
        payload.role !== Role.REVENDEDOR
        || payload.companyId
        || !payload.assumedUserId
        || !payload.assumedResellerId
      ) return null;
      const access = await db.superAdminResellerAccess?.findFirst?.({
        where: {
          id: payload.assumedAccessId,
          resellerId: payload.assumedResellerId,
          superAdminId: user.id,
          consumedAt: { not: null },
          revokedAt: null,
          closedAt: null,
          sessionExpiresAt: { gt: new Date() },
          reseller: { userId: payload.assumedUserId },
        },
        select: { id: true },
      });
      return access ? { company: null, resellerSupport: true } : null;
    }

    return null;
  }

  private topicRoom(companyId: string, topic: RealtimeTopic) {
    return `company:${companyId}:${topic}`;
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }

  private billingAllowsCompanyRealtime(
    subscription: { status?: SubscriptionStatus; trialEndsAt?: Date | null } | null | undefined,
    companyRole: boolean,
  ) {
    if (!companyRole) return true;
    const enforceBilling = process.env.BILLING_ENFORCEMENT === "true"
      || (process.env.NODE_ENV === "production" && process.env.BILLING_ENFORCEMENT !== "false");
    return !isTrialExpired(subscription)
      && (!enforceBilling || subscriptionAllowsAccess(subscription));
  }

  /**
   * O tópico é derivado do prefixo do evento (`order.*`, `delivery.*`, ...),
   * então os ~15 pontos de emissão continuam iguais e a regra fica num lugar
   * só. Evento sem prefixo mapeado é rejeitado em desenvolvimento em vez de
   * silenciosamente ir para ninguém.
   */
  emitToCompany(companyId: string, event: string, payload: unknown) {
    const topic = EVENT_TOPIC[event.split(".")[0]];
    if (!topic) {
      this.logger.error(`Evento sem tópico mapeado, não entregue: ${event}`);
      return;
    }
    this.emitToRoom(this.topicRoom(companyId, topic), event, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.emitToRoom(this.userRoom(userId), event, payload);
  }

  emitToResellers(event: string, payload: unknown) {
    this.emitToRoom("resellers", event, payload);
  }

  emitToSuperAdmins(event: string, payload: unknown) {
    this.emitToRoom("super-admins", event, payload);
  }

  /**
   * Derruba todas as conexões de um usuário.
   *
   * A autorização do socket só acontece no handshake: depois disso a conexão
   * vive indefinidamente com a credencial daquele instante. Sem isto, um
   * funcionário desativado continuava recebendo `order.created` com nome,
   * e-mail, endereço e valor de cada cliente até fechar a aba — o REST
   * bloqueava, o WebSocket não. Chame sempre que o vínculo mudar: desativação,
   * troca de papel, troca de empresa, troca ou redefinição de senha.
   */
  disconnectUser(userId: string, reason = "acesso revogado") {
    if (!this.server) return;
    this.server.to(this.userRoom(userId)).emit("session.revoked", { reason });
    this.server.in(this.userRoom(userId)).disconnectSockets(true);
    this.logger.log(`Sockets do usuário ${userId} encerrados: ${reason}.`);
  }

  private emitToRoom(room: string, event: string, payload: unknown) {
    if (!this.server) {
      this.logger.warn(`Evento websocket ignorado porque o gateway não está disponível: ${event}`);
      return;
    }
    this.server.to(room).emit(event, payload);
  }
}
