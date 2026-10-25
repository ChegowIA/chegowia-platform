import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { AuthenticationState, SignalDataSet, SignalDataTypeMap } from "@whiskeysockets/baileys";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { loadOutreachBaileys } from "./outreach-baileys-loader";

/** Auth Signal é propriedade exclusiva do outreach-worker, cifrada antes de persistir. */
@Injectable()
export class OutreachAuthStoreService {
  private readonly writes = new Map<string, Promise<void>>();
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  private db() { return this.prisma as any; }

  private encryptionKey() {
    const raw = process.env.OUTREACH_SESSION_ENCRYPTION_KEY ?? "";
    if (!/^[a-f\d]{64}$/i.test(raw)) throw new Error("OUTREACH_SESSION_ENCRYPTION_KEY deve conter 64 caracteres hexadecimais.");
    return Buffer.from(raw, "hex");
  }

  private encrypt(key: string, value: unknown) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey(), nonce);
    cipher.setAAD(Buffer.from(key));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value, this.bufferJson().replacer), "utf8"), cipher.final()]);
    return { ciphertext, nonce, tag: cipher.getAuthTag() };
  }

  private decrypt(key: string, row: { ciphertext: Buffer; nonce: Buffer; tag: Buffer }) {
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey(), row.nonce);
    decipher.setAAD(Buffer.from(key));
    decipher.setAuthTag(row.tag);
    return JSON.parse(Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8"), this.bufferJson().reviver);
  }

  private json: (typeof import("@whiskeysockets/baileys"))["BufferJSON"] | null = null;
  private bufferJson() {
    if (!this.json) throw new Error("Serializador Baileys não carregado.");
    return this.json;
  }

  private async read(key: string) {
    await this.writes.get(key);
    const row = await this.db().platformOutreachAuthState.findUnique({ where: { key } });
    return row ? this.decrypt(key, row) : null;
  }

  private async write(key: string, value: unknown) {
    const data = this.encrypt(key, value);
    return this.enqueue(key, () => this.db().platformOutreachAuthState.upsert({ where: { key }, create: { key, ...data }, update: data }));
  }

  private async enqueue(key: string, operation: () => Promise<unknown>) {
    const previous = this.writes.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(operation).then(() => undefined);
    this.writes.set(key, pending);
    try { await pending; }
    finally { if (this.writes.get(key) === pending) this.writes.delete(key); }
  }

  async clear() {
    await Promise.all([...this.writes.values()]);
    await this.db().platformOutreachAuthState.deleteMany({});
  }

  private async clearKeys() {
    await Promise.all([...this.writes.values()]);
    await this.db().platformOutreachAuthState.deleteMany({ where: { key: { startsWith: "key:" } } });
  }

  async load(): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
    const { BufferJSON, initAuthCreds, proto } = await loadOutreachBaileys();
    this.json = BufferJSON;
    const creds = (await this.read("creds")) ?? initAuthCreds();
    const state: AuthenticationState = {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const result: { [id: string]: SignalDataTypeMap[T] } = {};
          await Promise.all(ids.map(async (id) => {
            const value = await this.read(`key:${type}:${id}`);
            if (value) result[id] = type === "app-state-sync-key"
              ? proto.Message.AppStateSyncKeyData.fromObject(value) as unknown as SignalDataTypeMap[T] : value;
          }));
          return result;
        },
        set: async (data: SignalDataSet) => {
          for (const [type, entries] of Object.entries(data)) for (const [id, value] of Object.entries(entries ?? {})) {
            const key = `key:${type}:${id}`;
            if (value == null) await this.enqueue(key, () => this.db().platformOutreachAuthState.deleteMany({ where: { key } }));
            else await this.write(key, value);
          }
        },
        clear: () => this.clearKeys(),
      },
    };
    return { state, saveCreds: () => this.write("creds", state.creds) };
  }
}
