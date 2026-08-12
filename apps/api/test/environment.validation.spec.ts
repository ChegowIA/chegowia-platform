import { validateEnvironment } from "../src/common/config/environment.validation";

const validProduction = {
  NODE_ENV: "production",
  DATABASE_URL: "mysql://user:password@mysql:3306/chegowia",
  JWT_ACCESS_SECRET: "a".repeat(48),
  APP_URL: "https://chegowia.com.br",
  CORS_ORIGIN: "https://chegowia.com.br",
  SMTP_HOST: "smtp.example.com",
  SMTP_USER: "mailer",
  SMTP_PASSWORD: "mail-password-strong-123",
  MAIL_FROM: "ChegowIA <contato@chegowia.com.br>",
  OPS_ALERT_EMAIL: "operacao@chegowia.com.br",
  STRIPE_SECRET_KEY: `sk_live_${"a".repeat(32)}`,
  STRIPE_WEBHOOK_SECRET: `whsec_${"b".repeat(32)}`,
  STRIPE_CONNECT_WEBHOOK_SECRET: `whsec_${"d".repeat(32)}`,
  DEEPSEEK_API_KEY: `sk-${"c".repeat(32)}`,
  UPLOAD_ROOT: "/data/uploads",
  PRIVATE_UPLOAD_ROOT: "/data/private_uploads",
  CLAMAV_SCAN_ENABLED: "true",
  BILLING_ENFORCEMENT: "true",
  MFA_REQUIRED_ROLES: "SUPER_ADMIN,ADMIN,REVENDEDOR",
  FISCAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};

/**
 * O `.env.production.example` é o que a pessoa copia para montar o servidor.
 * Quando uma variável vira obrigatória no código e não entra no exemplo, o
 * container não sobe — e o erro só aparece no primeiro deploy, longe de quem
 * escreveu. Foi o que aconteceu com OPS_ALERT_EMAIL e FISCAL_ENCRYPTION_KEY.
 */
describe("exemplo de ambiente de produção", () => {
  it("declara toda variável que o boot exige", () => {
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const raiz = join(__dirname, "..", "..", "..");

    const validacao = readFileSync(join(raiz, "apps/api/src/common/config/environment.validation.ts"), "utf8");
    const bloco = validacao.slice(validacao.indexOf("const required ="), validacao.indexOf("const missing ="));
    const exigidas = [...bloco.matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]);

    const exemplo = readFileSync(join(raiz, ".env.production.example"), "utf8");
    const declaradas = new Set(
      [...exemplo.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]),
    );

    const ausentes = [...new Set(exigidas)].filter((nome) => !declaradas.has(nome));
    expect(ausentes).toEqual([]);
  });
});

describe("validateEnvironment", () => {
  it("aceita uma configuração de produção endurecida", () => {
    expect(validateEnvironment(validProduction)).toEqual(validProduction);
  });

  it("recusa Stripe de teste em produção", () => {
    expect(() => validateEnvironment({
      ...validProduction,
      STRIPE_SECRET_KEY: `sk_test_${"a".repeat(32)}`,
    })).toThrow("chave Stripe de teste");
  });

  it("exige destinatário para o alerta de dead-letter em produção", () => {
    const { OPS_ALERT_EMAIL: _omitido, ...semAlerta } = validProduction;
    expect(() => validateEnvironment(semAlerta)).toThrow("OPS_ALERT_EMAIL");
  });

  it("recusa escalar a API enquanto o limite de requisições for por processo", () => {
    expect(() => validateEnvironment({ ...validProduction, API_REPLICAS: "2" }))
      .toThrow("API_REPLICAS maior que 1");
  });

  it("aceita uma réplica explícita", () => {
    expect(() => validateEnvironment({ ...validProduction, API_REPLICAS: "1" })).not.toThrow();
  });

  it("recusa contagem de réplicas inválida", () => {
    expect(() => validateEnvironment({ ...validProduction, API_REPLICAS: "zero" }))
      .toThrow("inteiro maior ou igual a 1");
  });

  it("exige chave de cifragem do certificado fiscal", () => {
    const { FISCAL_ENCRYPTION_KEY: _omitido, ...semChave } = validProduction;
    expect(() => validateEnvironment(semChave)).toThrow("FISCAL_ENCRYPTION_KEY");
  });

  it("recusa chave fiscal com tamanho errado", () => {
    expect(() => validateEnvironment({
      ...validProduction,
      FISCAL_ENCRYPTION_KEY: Buffer.alloc(16, 7).toString("base64"),
    })).toThrow("32 bytes");
  });

  it("recusa reaproveitar a chave do WhatsApp para o fiscal", () => {
    const chave = Buffer.alloc(32, 9).toString("base64");
    expect(() => validateEnvironment({
      ...validProduction,
      FISCAL_ENCRYPTION_KEY: chave,
      WHATSAPP_TOKEN_ENCRYPTION_KEY: chave,
    })).toThrow("diferente de WHATSAPP_TOKEN_ENCRYPTION_KEY");
  });

  it("recusa placeholders em segredos de produção", () => {
    expect(() => validateEnvironment({
      ...validProduction,
      DEEPSEEK_API_KEY: "PREENCHER_COM_NOVA_CHAVE",
    })).toThrow("placeholders");
  });

  it("recusa arquivos privados dentro da área pública", () => {
    expect(() => validateEnvironment({
      ...validProduction,
      PRIVATE_UPLOAD_ROOT: "/data/uploads/public",
    })).toThrow("diretório separado");
  });

  it("exige a configuração completa do Gupshup ao habilitar o WhatsApp", () => {
    expect(() => validateEnvironment({
      ...validProduction,
      GUPSHUP_ENABLED: "true",
    })).toThrow(/GUPSHUP_API_KEY|GUPSHUP_WEBHOOK_TOKEN|WHATSAPP_TOKEN_ENCRYPTION_KEY/);

    const gupshupReady = {
      ...validProduction,
      GUPSHUP_ENABLED: "true",
      API_PUBLIC_URL: "https://api.chegowia.com.br",
      GUPSHUP_API_KEY: "k".repeat(32),
      GUPSHUP_WEBHOOK_TOKEN: "t".repeat(64),
      WHATSAPP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    };
    expect(validateEnvironment(gupshupReady)).toEqual(gupshupReady);
  });

  it("recusa segredo de webhook curto, que é a única prova de origem do callback", () => {
    // O Gupshup não assina o corpo como a Meta fazia; se este segredo for fraco,
    // qualquer um consegue injetar conversa no inbox.
    expect(() => validateEnvironment({
      ...validProduction,
      GUPSHUP_ENABLED: "true",
      API_PUBLIC_URL: "https://api.chegowia.com.br",
      GUPSHUP_API_KEY: "k".repeat(32),
      GUPSHUP_WEBHOOK_TOKEN: "curto",
      WHATSAPP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    })).toThrow("GUPSHUP_WEBHOOK_TOKEN");
  });
});
