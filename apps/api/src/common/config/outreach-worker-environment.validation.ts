/** Somente os segredos efetivamente usados pela prospecção entram neste processo. */
export function validateOutreachWorkerEnvironment(config: Record<string, unknown>) {
  const env = config as Record<string, string | undefined>;
  if (env.APP_ROLE !== "outreach-worker") {
    throw new Error("O processo de prospecção exige APP_ROLE=outreach-worker.");
  }

  const required = ["DATABASE_URL", "DEEPSEEK_API_KEY", "OUTREACH_SESSION_ENCRYPTION_KEY"];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new Error(`Variáveis de ambiente obrigatórias do worker ausentes: ${missing.join(", ")}`);
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(env.DATABASE_URL!);
  } catch {
    throw new Error("DATABASE_URL precisa ser uma URL MySQL válida.");
  }
  if (databaseUrl.protocol !== "mysql:") {
    throw new Error("DATABASE_URL precisa usar o protocolo mysql://.");
  }
  if (!/^[a-f\d]{64}$/i.test(env.OUTREACH_SESSION_ENCRYPTION_KEY!)) {
    throw new Error("OUTREACH_SESSION_ENCRYPTION_KEY deve conter 64 caracteres hexadecimais.");
  }
  if (env.NODE_ENV === "production" && /^(?:dev-secret|change-me|changeme|secret|preencher|troque)$/i.test(env.DEEPSEEK_API_KEY!.trim())) {
    throw new Error("DEEPSEEK_API_KEY não pode usar um valor de exemplo em produção.");
  }
  return config;
}
