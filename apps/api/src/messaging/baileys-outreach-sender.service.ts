import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { WASocket, WAMessage, WAMessageUpdate } from "@whiskeysockets/baileys";
import pino from "pino";
import { runsOutreachJobs } from "../common/config/app-role";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { normalizarTelefoneBrasileiro } from "./outreach-contacts";
import { OutreachAuthStoreService } from "./outreach-auth-store.service";
import { OutreachInboundService } from "./outreach-inbound.service";
import { loadOutreachBaileys } from "./outreach-baileys-loader";
import { OUTREACH_CHANNEL_KEY } from "./outreach-intelligence";

/** Apenas o processo outreach-worker abre o socket; a API troca comandos via banco. */
@Injectable()
export class BaileysOutreachSenderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BaileysOutreachSenderService.name);
  private socket: WASocket | null = null;
  private connected = false;
  private connecting = false;
  private timer?: NodeJS.Timeout;
  private nextReconnectAt = 0;
  private stopping = false;
  private loggedOutCode = 401;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly auth: OutreachAuthStoreService,
    private readonly inbound: OutreachInboundService,
  ) {}

  private db() { return this.prisma as any; }

  async onModuleInit() {
    if (!runsOutreachJobs()) return;
    // Um status CONECTADO de um processo anterior nunca pode autorizar a fila
    // antes de este worker autenticar um socket novo.
    await this.db().platformOutreachConnectionState.updateMany({ where: { id: "primary", status: "CONECTADO" },
      data: { status: "RECONECTANDO", qrCode: null, qrExpiresAt: null } });
    this.timer = setInterval(() => void this.tick().catch(() => this.logger.error("Falha ao atualizar conexão de prospecção.")), 3_000);
    void this.tick().catch(() => this.logger.error("Falha ao iniciar conexão de prospecção."));
  }

  onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.socket?.end(new Error("worker encerrado"));
    this.socket = null;
    this.connected = false;
  }

  async status() {
    const [state, channel] = await Promise.all([
      this.db().platformOutreachConnectionState.findUnique({ where: { id: "primary" } }),
      this.db().platformWhatsAppChannel.findFirst({ where: { key: OUTREACH_CHANNEL_KEY }, select: { id: true } }),
    ]);
    const fresh = state?.lastHeartbeatAt && Date.now() - new Date(state.lastHeartbeatAt).getTime() < 15_000;
    const [queued, sent, failed, active] = await Promise.all([
      this.db().platformOutreachTarget.count({ where: { campaign: { channelId: channel?.id ?? "__none__", status: "ENVIANDO" }, status: "PENDENTE" } }),
      this.db().platformOutreachTarget.count({ where: { campaign: { channelId: channel?.id ?? "__none__" }, status: { in: ["ENVIADO", "RESPONDEU"] } } }),
      this.db().platformOutreachTarget.count({ where: { campaign: { channelId: channel?.id ?? "__none__" }, status: "FALHOU" } }),
      this.db().platformOutreachCampaign.findFirst({ where: { channelId: channel?.id ?? "__none__", status: "ENVIANDO" }, select: { id: true, name: true } }),
    ]);
    return {
      provider: "BAILEYS", configured: Boolean(fresh && state?.status === "CONECTADO"),
      status: fresh ? state?.status ?? "DESCONECTADO" : "WORKER_OFFLINE",
      phone: state?.phone ?? null, qrCode: fresh && state?.qrExpiresAt && new Date(state.qrExpiresAt) > new Date() ? state.qrCode : null,
      workerOnline: Boolean(fresh), lastHeartbeatAt: state?.lastHeartbeatAt ?? null,
      lastError: state?.lastError ?? null, queued, sent, failed, activeCampaign: active,
    };
  }

  async requestConnect() {
    await this.db().platformOutreachConnectionState.upsert({ where: { id: "primary" },
      create: { id: "primary", desiredConnected: true, status: "AGUARDANDO_WORKER" },
      update: { desiredConnected: true, lastError: null } });
    return this.status();
  }

  async requestDisconnect() {
    await this.db().platformOutreachConnectionState.upsert({ where: { id: "primary" },
      create: { id: "primary", desiredConnected: false },
      update: { desiredConnected: false, qrCode: null, qrExpiresAt: null } });
    return this.status();
  }

  private async tick() {
    if (this.stopping) return;
    const state = await this.db().platformOutreachConnectionState.upsert({ where: { id: "primary" },
      create: { id: "primary", lastHeartbeatAt: new Date() }, update: { lastHeartbeatAt: new Date() } });
    if (!state.desiredConnected) {
      if (this.socket) await this.disconnect();
      return;
    }
    if (!this.socket && !this.connecting && Date.now() >= this.nextReconnectAt) {
      if (state.status === "CONECTADO") await this.db().platformOutreachConnectionState.update({ where: { id: "primary" }, data: { status: "RECONECTANDO" } });
      await this.connect();
    }
  }

  private async connect() {
    this.connecting = true;
    try {
      const { makeWASocket, DisconnectReason } = await loadOutreachBaileys();
      this.loggedOutCode = DisconnectReason.loggedOut;
      const { state, saveCreds } = await this.auth.load();
      const socket = makeWASocket({ auth: state, printQRInTerminal: false, markOnlineOnConnect: false,
        syncFullHistory: false, defaultQueryTimeoutMs: 20_000, logger: pino({ level: "silent" }) });
      this.socket = socket;
      await this.db().platformOutreachConnectionState.update({ where: { id: "primary" }, data: {
        status: "CONECTANDO", qrCode: null, qrExpiresAt: null, lastError: null,
      } });
      socket.ev.on("creds.update", () => {
        if (this.socket === socket) void saveCreds().catch(() => this.logger.error("Falha ao persistir autenticação do WhatsApp."));
      });
      socket.ev.on("connection.update", (update) => void this.connectionUpdate(socket, update).catch(() => this.logger.error("Falha ao atualizar estado do WhatsApp.")));
      socket.ev.on("messages.upsert", ({ messages, type }) => {
        if (type !== "notify") return;
        for (const message of messages.slice(0, 50)) void this.receive(message).catch(() => this.logger.error("Falha ao registrar resposta de prospecção."));
      });
      socket.ev.on("messages.update", (updates) => {
        for (const item of updates.slice(0, 100)) void this.deliveryUpdate(item)
          .catch(() => this.logger.error("Falha ao registrar confirmação de mensagem de prospecção."));
      });
    } catch {
      this.socket = null;
      this.nextReconnectAt = Date.now() + 30_000;
      await this.db().platformOutreachConnectionState.update({ where: { id: "primary" }, data: {
        status: "ERRO", lastError: "Não foi possível iniciar a sessão; verifique o worker e a chave de criptografia.",
      } });
      this.logger.error("Falha ao iniciar sessão Baileys; nova tentativa em 30 segundos.");
    } finally { this.connecting = false; }
  }

  private async connectionUpdate(socket: WASocket, update: { qr?: string; connection?: string; lastDisconnect?: { error?: Error } }) {
    if (socket !== this.socket || this.stopping) return;
    if (update.qr) await this.db().platformOutreachConnectionState.update({ where: { id: "primary" }, data: {
      status: "AGUARDANDO_QR", qrCode: update.qr, qrExpiresAt: new Date(Date.now() + 60_000), lastError: null,
    } });
    if (update.connection === "open") {
      this.connected = true;
      const phone = socket.user?.id?.split(":")[0]?.split("@")[0] ?? null;
      await this.db().platformOutreachConnectionState.update({ where: { id: "primary" }, data: {
        status: "CONECTADO", phone, qrCode: null, qrExpiresAt: null, lastError: null,
      } });
    }
    if (update.connection === "close") {
      this.connected = false;
      this.socket = null;
      const code = (update.lastDisconnect?.error as any)?.output?.statusCode;
      const loggedOut = code === this.loggedOutCode;
      if (loggedOut) await this.auth.clear();
      this.nextReconnectAt = Date.now() + 10_000;
      await this.db().platformOutreachConnectionState.update({ where: { id: "primary" }, data: {
        desiredConnected: loggedOut ? false : undefined,
        status: loggedOut ? "DESCONECTADO" : "RECONECTANDO", qrCode: null, qrExpiresAt: null,
        phone: loggedOut ? null : undefined,
        lastError: loggedOut ? "Sessão encerrada no WhatsApp; conecte novamente." : "Conexão interrompida; reconectando.",
      } });
    }
  }

  private async disconnect() {
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    if (socket) {
      try { await socket.logout(); } catch { socket.end(new Error("desconectado pelo administrador")); }
    }
    await this.auth.clear();
    await this.db().platformOutreachConnectionState.update({ where: { id: "primary" }, data: {
      status: "DESCONECTADO", phone: null, qrCode: null, qrExpiresAt: null, lastError: null,
    } });
  }

  async sendText(input: { to: string; text: string; attemptId: string }) {
    const phone = normalizarTelefoneBrasileiro(input.to);
    if (!phone || !this.connected || !this.socket) throw new Error("Remetente de prospecção não está conectado.");
    const result = await this.socket.sendMessage(`${phone}@s.whatsapp.net`, { text: input.text });
    if (!result?.key?.id) throw new Error("O WhatsApp não confirmou o identificador da mensagem.");
    return { messageId: result.key.id };
  }

  private async receive(message: WAMessage) {
    if (message.key.fromMe || !message.key.id || !message.key.remoteJid?.endsWith("@s.whatsapp.net")) return;
    const phone = normalizarTelefoneBrasileiro(message.key.remoteJid.split("@")[0]);
    const text = message.message?.conversation ?? message.message?.extendedTextMessage?.text;
    if (phone && text?.trim()) await this.inbound.record(phone, message.key.id, text.trim().slice(0, 2000));
  }

  private async deliveryUpdate(item: WAMessageUpdate) {
    if (!item.key.fromMe || !item.key.id) return;
    const status = item.update.status;
    const mapped = status === 0 ? "FALHOU" : status === 3 ? "ENTREGUE" : status === 4 || status === 5 ? "LIDA" : null;
    if (!mapped) return;
    const channel = await this.db().platformWhatsAppChannel.findUnique({ where: { key: OUTREACH_CHANNEL_KEY }, select: { id: true } });
    if (!channel) return;
    await this.db().platformWhatsAppMessage.updateMany({ where: { channelId: channel.id, providerMessageId: item.key.id,
      status: { in: mapped === "LIDA" ? ["ENVIADA", "ENTREGUE"] : ["ENVIADA"] } },
      data: { status: mapped } });
  }
}
