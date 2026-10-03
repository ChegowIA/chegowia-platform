import { JwtPayload } from "../interfaces/jwt-payload.interface";

/** Uma sessão confirmada por MFA nunca pode sobreviver mais que 24 horas. */
export const MFA_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface MfaSessionWindow {
  startedAt: Date;
  expiresAt: Date;
}

export function createMfaSessionWindow(now = new Date()): MfaSessionWindow {
  return {
    startedAt: now,
    expiresAt: new Date(now.getTime() + MFA_SESSION_TTL_MS),
  };
}

/**
 * Uma visão temporária de suporte pode encurtar a janela, mas nunca ampliá-la.
 */
export function limitMfaSessionWindow(
  session: MfaSessionWindow,
  limit?: Date | null,
): MfaSessionWindow {
  if (!limit || limit.getTime() >= session.expiresAt.getTime()) return session;
  return { ...session, expiresAt: limit };
}

/**
 * Lê e valida o carimbo assinado da sessão. Tokens emitidos antes da política
 * universal de MFA não têm esses campos e, portanto, deixam de ser aceitos.
 */
export function activeMfaSessionFromPayload(
  payload: Pick<JwtPayload, "mfaSessionStartedAt" | "mfaSessionExpiresAt">,
  now = Date.now(),
): MfaSessionWindow | null {
  const startedAt = payload.mfaSessionStartedAt;
  const expiresAt = payload.mfaSessionExpiresAt;
  if (!Number.isFinite(startedAt) || !Number.isFinite(expiresAt)) return null;
  if ((startedAt as number) > now || (expiresAt as number) <= now) return null;
  // Além de expirada, uma janela maior que 24h denuncia token legado ou fluxo
  // que não passou pelo emissor central de MFA.
  if ((expiresAt as number) - (startedAt as number) > MFA_SESSION_TTL_MS) return null;
  return {
    startedAt: new Date(startedAt as number),
    expiresAt: new Date(expiresAt as number),
  };
}
