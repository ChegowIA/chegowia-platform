const PLACEHOLDER_VALUES = new Set([
  "dev-secret",
  "change-me",
  "changeme",
  "secret",
  "password",
]);

function looksLikePlaceholder(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    PLACEHOLDER_VALUES.has(normalized)
    || normalized.includes("preencher")
    || normalized.includes("gerar_")
    || normalized.includes("troque")
    || normalized.includes("example")
  );
}

export function validateEnvironment(config: Record<string, unknown>) {
  const env = { ...config } as Record<string, string | undefined>;
  const production = env.NODE_ENV === "production";
  const whatsappCloudEnabled = env.WHATSAPP_CLOUD_API_ENABLED === "true";
  const embeddedSignupEnabled = env.META_EMBEDDED_SIGNUP_ENABLED === "true";
  const required = ["DATABASE_URL", "JWT_ACCESS_SECRET", "APP_URL", "CORS_ORIGIN"];

  if (production && embeddedSignupEnabled && !whatsappCloudEnabled) {
    throw new Error("META_EMBEDDED_SIGNUP_ENABLED exige WHATSAPP_CLOUD_API_ENABLED=true.");
  }

  if (production) {
    required.push(
      "SMTP_HOST",
      "SMTP_USER",
      "SMTP_PASSWORD",
      "MAIL_FROM",
      // Sem destinatário o alerta de dead-letter vira só uma linha de log:
      // fatura paga sem acesso liberado passaria dias sem ninguém perceber.
      "OPS_ALERT_EMAIL",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_CONNECT_WEBHOOK_SECRET",
      "DEEPSEEK_API_KEY",
      "UPLOAD_ROOT",
      "PRIVATE_UPLOAD_ROOT",
      "BILLING_ENFORCEMENT",
      "MFA_REQUIRED_ROLES",
      // Sem ela o certificado A1 não pode ser guardado nem lido, e o cadastro
      // fiscal fica inutilizável — melhor falhar no boot do que na emissão.
      "FISCAL_ENCRYPTION_KEY",
    );
    if (whatsappCloudEnabled) {
      required.push(
        "API_PUBLIC_URL",
        "META_APP_SECRET",
        "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
        "WHATSAPP_TOKEN_ENCRYPTION_KEY",
      );
    }
    if (embeddedSignupEnabled) {
      required.push("META_APP_ID", "META_EMBEDDED_SIGNUP_CONFIG_ID");
    }
  }

  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new Error(`Variáveis de ambiente obrigatórias ausentes: ${missing.join(", ")}`);
  }

  for (const key of ["JWT_ACCESS_SECRET"]) {
    const value = env[key]?.trim() ?? "";
    if (production && (value.length < 32 || looksLikePlaceholder(value))) {
      throw new Error(`${key} deve ter pelo menos 32 caracteres aleatórios em produção.`);
    }
  }

  if (production) {
    let appUrl: URL;
    try {
      appUrl = new URL(env.APP_URL!);
    } catch {
      throw new Error("APP_URL precisa ser uma URL HTTPS válida em produção.");
    }
    if (appUrl.protocol !== "https:" || appUrl.username || appUrl.password) {
      throw new Error("APP_URL precisa usar HTTPS em produção.");
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

    const origins = (env.CORS_ORIGIN ?? "").split(",").map((value) => value.trim());
    if (
      origins.some((origin) => {
        try {
          const url = new URL(origin);
          return url.protocol !== "https:" || Boolean(url.username || url.password) || origin.includes("*");
        } catch {
          return true;
        }
      })
    ) {
      throw new Error("CORS_ORIGIN deve conter apenas origens HTTPS explícitas em produção.");
    }

    const secretKeys = [
      "SMTP_PASSWORD",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_CONNECT_WEBHOOK_SECRET",
      "DEEPSEEK_API_KEY",
    ];
    const placeholders = secretKeys.filter((key) => looksLikePlaceholder(env[key] ?? ""));
    if (placeholders.length) {
      throw new Error(`Segredos de produção ainda contêm placeholders: ${placeholders.join(", ")}`);
    }

    const stripeKey = env.STRIPE_SECRET_KEY ?? "";
    const testModeAllowed = env.ALLOW_STRIPE_TEST_IN_PRODUCTION === "true";
    if (stripeKey.startsWith("sk_test_") && !testModeAllowed) {
      throw new Error(
        "Uma chave Stripe de teste não pode iniciar em produção. Use a chave live ou habilite explicitamente ALLOW_STRIPE_TEST_IN_PRODUCTION apenas em homologação.",
      );
    }
    if (
      (!testModeAllowed && !/^sk_live_[A-Za-z0-9]{16,}$/.test(stripeKey))
      || (testModeAllowed && !/^sk_(?:live|test)_[A-Za-z0-9]{16,}$/.test(stripeKey))
    ) {
      throw new Error(
        "STRIPE_SECRET_KEY precisa ser uma chave secreta Stripe válida para este ambiente.",
      );
    }
    if (!/^whsec_[A-Za-z0-9]{16,}$/.test(env.STRIPE_WEBHOOK_SECRET ?? "")) {
      throw new Error("STRIPE_WEBHOOK_SECRET precisa ser o segredo válido do endpoint de produção.");
    }
    if (!/^whsec_[A-Za-z0-9]{16,}$/.test(env.STRIPE_CONNECT_WEBHOOK_SECRET ?? "")) {
      throw new Error(
        "STRIPE_CONNECT_WEBHOOK_SECRET precisa ser o segredo válido do endpoint de contas conectadas.",
      );
    }
    if ((env.DEEPSEEK_API_KEY ?? "").length < 24) {
      throw new Error("DEEPSEEK_API_KEY parece incompleta.");
    }

    const requiredMfaRoles = ["SUPER_ADMIN", "ADMIN", "REVENDEDOR"];
    const configuredMfaRoles = new Set(
      (env.MFA_REQUIRED_ROLES ?? "").split(",").map((role) => role.trim()).filter(Boolean),
    );
    if (requiredMfaRoles.some((role) => !configuredMfaRoles.has(role))) {
      throw new Error("MFA_REQUIRED_ROLES deve proteger SUPER_ADMIN, ADMIN e REVENDEDOR.");
    }

    const fiscalKey = env.FISCAL_ENCRYPTION_KEY ?? "";
    const fiscalDecoded = /^[a-f0-9]{64}$/i.test(fiscalKey)
      ? Buffer.from(fiscalKey, "hex")
      : Buffer.from(fiscalKey, "base64");
    if (fiscalDecoded.length !== 32) {
      throw new Error("FISCAL_ENCRYPTION_KEY deve codificar exatamente 32 bytes.");
    }
    // Reaproveitar a chave do WhatsApp faria o vazamento de uma virar o
    // vazamento das duas, e impediria rotacionar uma sem tocar na outra.
    if (fiscalKey === (env.WHATSAPP_TOKEN_ENCRYPTION_KEY ?? "")) {
      throw new Error("FISCAL_ENCRYPTION_KEY precisa ser diferente de WHATSAPP_TOKEN_ENCRYPTION_KEY.");
    }

    if (!env.UPLOAD_ROOT?.startsWith("/") || !env.PRIVATE_UPLOAD_ROOT?.startsWith("/")) {
      throw new Error("UPLOAD_ROOT e PRIVATE_UPLOAD_ROOT precisam ser caminhos absolutos.");
    }

    if (whatsappCloudEnabled) {
      let apiUrl: URL;
      try {
        apiUrl = new URL(env.API_PUBLIC_URL!);
      } catch {
        throw new Error("API_PUBLIC_URL precisa ser uma URL HTTPS válida para receber o webhook da Meta.");
      }
      if (apiUrl.protocol !== "https:" || apiUrl.username || apiUrl.password) {
        throw new Error("API_PUBLIC_URL precisa usar HTTPS e não pode conter credenciais.");
      }
      if ((env.META_APP_SECRET ?? "").length < 16 || looksLikePlaceholder(env.META_APP_SECRET ?? "")) {
        throw new Error("META_APP_SECRET precisa ser o App Secret real da aplicação Meta.");
      }
      if ((env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "").length < 16 || looksLikePlaceholder(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "")) {
        throw new Error("WHATSAPP_WEBHOOK_VERIFY_TOKEN precisa ter pelo menos 16 caracteres aleatórios.");
      }
      const encryptionKey = env.WHATSAPP_TOKEN_ENCRYPTION_KEY ?? "";
      const decodedKey = /^[a-f0-9]{64}$/i.test(encryptionKey)
        ? Buffer.from(encryptionKey, "hex")
        : Buffer.from(encryptionKey, "base64");
      if (decodedKey.length !== 32) {
        throw new Error("WHATSAPP_TOKEN_ENCRYPTION_KEY deve codificar exatamente 32 bytes.");
      }
      if (embeddedSignupEnabled) {
        if (!/^\d{5,32}$/.test(env.META_APP_ID ?? "")) {
          throw new Error("META_APP_ID precisa ser o identificador numérico do App Meta.");
        }
        if (!/^\d{5,32}$/.test(env.META_EMBEDDED_SIGNUP_CONFIG_ID ?? "")) {
          throw new Error("META_EMBEDDED_SIGNUP_CONFIG_ID precisa ser o identificador da configuração do Embedded Signup.");
        }
      }
    }
  }

  if (production && env.CLAMAV_SCAN_ENABLED !== "true") {
    throw new Error("CLAMAV_SCAN_ENABLED deve estar ativo em produção para proteger currículos enviados.");
  }
  if (
    production
    && (env.UPLOAD_ROOT === env.PRIVATE_UPLOAD_ROOT || env.PRIVATE_UPLOAD_ROOT?.includes("/public"))
  ) {
    throw new Error("Arquivos privados precisam usar um diretório separado e não público.");
  }
  /**
   * O ThrottlerGuard guarda a contagem na memória do processo. Com uma réplica
   * o limite de 120/min por IP vale; com N réplicas cada uma conta sozinha e o
   * limite efetivo vira N×120/min — sem erro, sem log, sem sintoma.
   *
   * Separar o worker (APP_ROLE, ver common/config/app-role.ts) tornou a API
   * escalável em tudo menos nisto. Como o armazenamento compartilhado ainda
   * não existe, a trava é explícita: declarar mais de uma réplica falha o boot
   * em vez de degradar a proteção em silêncio.
   */
  if (production) {
    const replicas = Number(env.API_REPLICAS ?? "1");
    if (!Number.isInteger(replicas) || replicas < 1) {
      throw new Error("API_REPLICAS precisa ser um inteiro maior ou igual a 1.");
    }
    if (replicas > 1) {
      throw new Error(
        "API_REPLICAS maior que 1 ainda não é suportado: o limite de requisições é contado na memória "
        + "de cada processo, então N réplicas multiplicam o limite por N. Implemente armazenamento "
        + "compartilhado para o ThrottlerModule (app.module.ts) antes de escalar a API.",
      );
    }
  }

  if (production && env.BILLING_ENFORCEMENT !== "true") {
    throw new Error("BILLING_ENFORCEMENT deve estar ativo em produção.");
  }
  if (production && env.ENABLE_SWAGGER === "true") {
    throw new Error("ENABLE_SWAGGER não deve ser ativado no ambiente público de produção.");
  }

  return config;
}
