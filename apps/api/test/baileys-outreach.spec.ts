import { EventEmitter } from "node:events";
import { OutreachAuthStoreService } from "../src/messaging/outreach-auth-store.service";
import { BaileysOutreachSenderService, RemetenteDesconectadoError } from "../src/messaging/baileys-outreach-sender.service";
import { OutreachInboundService } from "../src/messaging/outreach-inbound.service";

const socketEvents = new EventEmitter();
const socket: any = {
  ev: socketEvents, user: { id: "5562999998888:1@s.whatsapp.net" },
  sendMessage: jest.fn().mockResolvedValue({ key: { id: "wamid-test" } }),
  logout: jest.fn().mockResolvedValue(undefined), end: jest.fn(),
};
jest.mock("../src/messaging/outreach-baileys-loader", () => ({
  loadOutreachBaileys: jest.fn().mockResolvedValue({
    makeWASocket: () => socket, DisconnectReason: { loggedOut: 401 },
    initAuthCreds: () => ({ registered: false }),
    BufferJSON: { replacer: (_key: string, value: unknown) => value, reviver: (_key: string, value: unknown) => value },
    proto: { Message: { AppStateSyncKeyData: { fromObject: (value: unknown) => value } } },
  }),
}));

describe("auth cifrada e conexão QR exclusiva da prospecção", () => {
  const previous = process.env.OUTREACH_SESSION_ENCRYPTION_KEY;
  beforeAll(() => { process.env.OUTREACH_SESSION_ENCRYPTION_KEY = "ab".repeat(32); });
  afterAll(() => { process.env.OUTREACH_SESSION_ENCRYPTION_KEY = previous; });
  afterEach(() => { socketEvents.removeAllListeners(); jest.clearAllMocks(); });

  function authFixture() {
    const rows = new Map<string, any>();
    const table: any = {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(rows.get(where.key) ?? null)),
      upsert: jest.fn(({ where, create, update }: any) => {
        rows.set(where.key, rows.has(where.key) ? { ...rows.get(where.key), ...update } : create);
        return Promise.resolve(rows.get(where.key));
      }),
      deleteMany: jest.fn(({ where }: any = {}) => {
        if (typeof where?.key === "string") rows.delete(where.key);
        else if (where?.key?.startsWith) {
          for (const key of rows.keys()) if (key.startsWith(where.key.startsWith)) rows.delete(key);
        }
        else rows.clear();
        return Promise.resolve({ count: 1 });
      }),
    };
    return { rows, table, service: new OutreachAuthStoreService({ platformOutreachAuthState: table } as never) };
  }

  it("persiste credenciais cifradas e restaura a sessão sem expor o texto", async () => {
    const { rows, service } = authFixture();
    const first = await service.load();
    first.state.creds = { ...first.state.creds, testSecret: "segredo-teste" } as any;
    await first.saveCreds();
    expect(rows.get("creds").ciphertext.toString("utf8")).not.toContain("segredo-teste");
    const restored = await service.load();
    expect((restored.state.creds as any).testSecret).toBe("segredo-teste");
    await restored.state.keys.set({ "session": { "peer-1": { registrationId: 1 } as any } });
    await restored.state.keys.clear?.();
    expect(rows.has("creds")).toBe(true);
    expect(rows.has("key:session:peer-1")).toBe(false);
    rows.get("creds").tag[0] ^= 1;
    await expect(service.load()).rejects.toThrow();
  });

  it("conecta, expõe somente QR temporário, envia e desconecta sem envio real", async () => {
    const saveCreds = jest.fn().mockResolvedValue(undefined);
    const auth = { load: jest.fn().mockResolvedValue({ state: { creds: {}, keys: {} }, saveCreds }), clear: jest.fn() };
    const state: any = { id: "primary", desiredConnected: true, status: "DESCONECTADO", phone: null,
      qrCode: null, qrExpiresAt: null, lastHeartbeatAt: new Date() };
    const connectionTable: any = {
      upsert: jest.fn(({ create, update }: any) => Promise.resolve(Object.assign(state, state.id ? update : create))),
      update: jest.fn(({ data }: any) => Promise.resolve(Object.assign(state,
        Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))))),
      findUnique: jest.fn(() => Promise.resolve(state)),
    };
    const db: any = {
      platformOutreachConnectionState: connectionTable,
      platformWhatsAppChannel: { findFirst: jest.fn().mockResolvedValue({ id: "ch1" }), findUnique: jest.fn().mockResolvedValue({ id: "ch1" }) },
      platformWhatsAppMessage: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      platformOutreachTarget: { count: jest.fn().mockResolvedValue(0) },
      platformOutreachCampaign: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const inbound = { record: jest.fn().mockResolvedValue(undefined) };
    const service: any = new BaileysOutreachSenderService(db, auth as never, inbound as never);
    await service.tick();
    await service.connectionUpdate(socket, { qr: "qr-prova" });
    expect((await service.status()).qrCode).toBe("qr-prova");
    await service.connectionUpdate(socket, { connection: "open" });
    expect((await service.status()).phone).toBe("5562999998888");
    expect((await service.status()).qrCode).toBeNull();
    socketEvents.emit("creds.update", { registered: true });
    expect(saveCreds).toHaveBeenCalled();
    expect(await service.sendText({ to: "(62) 99999-8888", text: "Mensagem aprovada", attemptId: "a1" }))
      .toEqual({ messageId: "wamid-test" });
    expect(socket.sendMessage).toHaveBeenCalledWith("5562999998888@s.whatsapp.net", { text: "Mensagem aprovada" });
    await service.receive({ key: { fromMe: false, id: "resposta-1", remoteJid: "5562999998888@s.whatsapp.net" },
      message: { conversation: "Não quero receber" } });
    expect(inbound.record).toHaveBeenCalledWith("5562999998888", "resposta-1", "Não quero receber");
    await service.deliveryUpdate({ key: { id: "wamid-test", fromMe: true }, update: { status: 3 } });
    expect(db.platformWhatsAppMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "ENTREGUE" },
    }));
    await service.connectionUpdate(socket, { connection: "close", lastDisconnect: { error: { output: { statusCode: 500 } } } });
    expect((await service.status()).status).toBe("RECONECTANDO");
    service.nextReconnectAt = 0;
    await service.tick();
    expect(auth.load).toHaveBeenCalledTimes(2);
    await service.requestDisconnect();
    await service.tick();
    expect(auth.clear).toHaveBeenCalled();
    expect(socket.logout).toHaveBeenCalled();
    expect((await service.status()).status).toBe("DESCONECTADO");
  });

  it("descadastro bloqueia inclusive se não houver alvo recente", async () => {
    const db: any = {
      platformWhatsAppChannel: { findUnique: jest.fn().mockResolvedValue({ id: "ch1" }) },
      platformOutreachBlock: { upsert: jest.fn().mockResolvedValue({}) },
      platformOutreachTarget: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findFirst: jest.fn().mockResolvedValue(null) },
      platformWhatsAppMessage: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    db.$transaction = (fn: (tx: any) => Promise<unknown>) => fn(db);
    await new OutreachInboundService(db).record("5562999998888", "msg-1", "Não quero receber mensagens");
    expect(db.platformOutreachBlock.upsert).toHaveBeenCalled();
    expect(db.platformOutreachTarget.updateMany).toHaveBeenCalled();
  });

  it("não deixa o envio pendurado quando o WhatsApp não responde", async () => {
    jest.useFakeTimers();
    try {
      const service: any = new BaileysOutreachSenderService({} as never, {} as never, {} as never);
      Object.assign(service, { connected: true, socket: { sendMessage: () => new Promise(() => undefined) } });
      const envio = service.sendText({ to: "(62) 99999-8888", text: "Oi", attemptId: "a1" });
      jest.advanceTimersByTime(60_000);
      await expect(envio).rejects.toThrow(/não respondeu/);
    } finally { jest.useRealTimers(); }
  });

  it("sinaliza socket fechado como falha antes do envio", async () => {
    const service: any = new BaileysOutreachSenderService({} as never, {} as never, {} as never);
    await expect(service.sendText({ to: "(62) 99999-8888", text: "Oi", attemptId: "a1" }))
      .rejects.toBeInstanceOf(RemetenteDesconectadoError);
  });
});
