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
  if (env.APP_ROLE === "outreach-worker") {
    throw new Error("APP_ROLE=outreach-worker foi desativado: a prospecção roda no worker principal. Exclua este serviço.");
  }
  const production = env.NODE_ENV === "production";
  const gupshupEnabled = env.GUPSHUP_ENABLED === "true";
  // Provedor que atende contratações novas. Assinatura já criada no Stripe segue
  // sendo cobrada por ele, então as chaves da Stripe continuam exigidas enquanto
  // ele for o provedor corrente.
  const asaasBilling = env.BILLING_PROVIDER === "ASAAS";
  const required = ["DATABASE_URL", "JWT_ACCESS_SECRET", "APP_URL", "CORS_ORIGIN"];

  if (production) {
    required.push(
      "SMTP_HOST",
      "SMTP_USER",
      "SMTP_PASSWORD",
      "MAIL_FROM",
      // Sem destinatário o alerta de dead-letter vira só uma linha de log:
      // fatura paga sem acesso liberado passaria dias sem ninguém perceber.
      "OPS_ALERT_EMAIL",
      "DEEPSEEK_API_KEY",
      "UPLOAD_ROOT",
      "PRIVATE_UPLOAD_ROOT",
      "BILLING_ENFORCEMENT",
      "MFA_REQUIRED_ROLES",
      // Sem ela o certificado A1 não pode ser guardado nem lido, e o cadastro
      // fiscal fica inutilizável — melhor falhar no boot do que na emissão.
      "FISCAL_ENCRYPTION_KEY",
    );
    if (asaasBilling) {
      required.push(
        "ASAAS_API_KEY",
        // Única prova de origem do webhook: o Asaas não assina o corpo.
        "ASAAS_WEBHOOK_TOKEN",
        // O callback precisa chegar de fora para a assinatura ser liberada.
        "API_PUBLIC_URL",
      );
    } else {
      required.push(
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "STRIPE_CONNECT_WEBHOOK_SECRET",
      );
    }
    if (gupshupEnabled) {
      required.push(
        "API_PUBLIC_URL",
        "GUPSHUP_API_KEY",
        // Autentica o callback: sem ele qualquer um poderia injetar conversa.
        "GUPSHUP_WEBHOOK_TOKEN",
        "WHATSAPP_TOKEN_ENCRYPTION_KEY",
      );
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
      "DEEPSEEK_API_KEY",
      ...(asaasBilling
        ? ["ASAAS_API_KEY", "ASAAS_WEBHOOK_TOKEN"]
        : ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_CONNECT_WEBHOOK_SECRET"]),
    ];
    const placeholders = secretKeys.filter((key) => looksLikePlaceholder(env[key] ?? ""));
    if (placeholders.length) {
      throw new Error(`Segredos de produção ainda contêm placeholders: ${placeholders.join(", ")}`);
    }

    if (asaasBilling) {
      const asaasKey = env.ASAAS_API_KEY ?? "";
      // A chave carrega o ambiente: a de homologação não move dinheiro de
      // verdade, e subir com ela em produção deixaria todo mundo "assinando" de
      // graça sem ninguém perceber.
      const sandboxAllowed = env.ALLOW_ASAAS_SANDBOX_IN_PRODUCTION === "true";
      if (!asaasKey.startsWith("$aact_") ) {
        throw new Error("ASAAS_API_KEY precisa ser a chave da API do Asaas (começa com $aact_).");
      }
      if (asaasKey.startsWith("$aact_hmlg_") && !sandboxAllowed) {
        throw new Error(
          "Uma chave de homologação do Asaas não pode iniciar em produção. Use a chave de produção ou habilite ALLOW_ASAAS_SANDBOX_IN_PRODUCTION apenas em ambiente de teste.",
        );
      }
      if ((env.ASAAS_WEBHOOK_TOKEN ?? "").trim().length < 20) {
        throw new Error("ASAAS_WEBHOOK_TOKEN deve ter pelo menos 20 caracteres aleatórios.");
      }
    }

    // No Asaas, a Stripe vira opcional: só permanece configurada enquanto houver
    // assinatura antiga sendo cobrada por ela. Quando estiver presente, porém, o
    // formato continua sendo conferido — chave meia-boca em produção é pior do
    // que chave nenhuma.
    const stripeKey = env.STRIPE_SECRET_KEY ?? "";
    if (!asaasBilling || stripeKey) {
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

    if (gupshupEnabled) {
      let apiUrl: URL;
      try {
        apiUrl = new URL(env.API_PUBLIC_URL!);
      } catch {
        throw new Error("API_PUBLIC_URL precisa ser uma URL HTTPS válida para receber o callback do Gupshup.");
      }
      if (apiUrl.protocol !== "https:" || apiUrl.username || apiUrl.password) {
        throw new Error("API_PUBLIC_URL precisa usar HTTPS e não pode conter credenciais.");
      }
      if ((env.GUPSHUP_API_KEY ?? "").length < 16 || looksLikePlaceholder(env.GUPSHUP_API_KEY ?? "")) {
        throw new Error("GUPSHUP_API_KEY precisa ser a chave real da conta no Gupshup.");
      }
      // O Gupshup não assina o corpo do callback como a Meta fazia; este segredo
      // na URL é a única prova de origem, então precisa de entropia real.
      if ((env.GUPSHUP_WEBHOOK_TOKEN ?? "").length < 16 || looksLikePlaceholder(env.GUPSHUP_WEBHOOK_TOKEN ?? "")) {
        throw new Error("GUPSHUP_WEBHOOK_TOKEN precisa ter pelo menos 16 caracteres aleatórios.");
      }
      const encryptionKey = env.WHATSAPP_TOKEN_ENCRYPTION_KEY ?? "";
      const decodedKey = /^[a-f0-9]{64}$/i.test(encryptionKey)
        ? Buffer.from(encryptionKey, "hex")
        : Buffer.from(encryptionKey, "base64");
      if (decodedKey.length !== 32) {
        throw new Error("WHATSAPP_TOKEN_ENCRYPTION_KEY deve codificar exatamente 32 bytes.");
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
