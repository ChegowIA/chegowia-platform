import * as forge from "node-forge";
import { FiscalCertificateStatus, FiscalEnvironment, TaxRegime } from "@prisma/client";
import { FiscalSecretsService } from "../src/fiscal/fiscal-secrets.service";
import { FiscalService } from "../src/fiscal/fiscal.service";
import { readCertificate } from "../src/fiscal/certificate-reader";

const CHAVE = Buffer.alloc(32, 3).toString("base64");

/**
 * Gera um PKCS#12 de verdade em vez de mockar a leitura: o ponto do teste é
 * que um .pfx real seja aberto, tenha os metadados extraídos e a validade
 * conferida. Um mock provaria apenas que o mock funciona.
 */
function gerarCertificado(options: { subject?: string; anos?: number; senha?: string } = {}) {
  const senha = options.senha ?? "senha-forte";
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "0123456789";
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + (options.anos ?? 1) * 365 * 24 * 60 * 60 * 1000);
  const attrs = [{ name: "commonName", value: options.subject ?? "LOJA TESTE LTDA:12345678000199" }];
  cert.setSubject(attrs);
  cert.setIssuer([{ name: "commonName", value: "AC TESTE" }]);
  cert.sign(keys.privateKey);

  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, { algorithm: "3des" });
  return { buffer: Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary"), senha, cert };
}

describe("leitura do certificado A1", () => {
  it("extrai titular, emissor e validade de um .pfx real", () => {
    const { buffer, senha, cert } = gerarCertificado();

    const dados = readCertificate(buffer, senha);

    expect(dados.subjectName).toContain("LOJA TESTE LTDA");
    expect(dados.issuerName).toBe("AC TESTE");
    expect(dados.document).toBe("12345678000199");
    // O X.509 guarda a validade com precisão de segundos; os milissegundos do
    // Date original não sobrevivem à serialização.
    expect(Math.floor(dados.notAfter.getTime() / 1000))
      .toBe(Math.floor(cert.validity.notAfter.getTime() / 1000));
  });

  it("senha errada não vaza o motivo — mensagem única para arquivo e senha", () => {
    const { buffer } = gerarCertificado();
    expect(() => readCertificate(buffer, "errada")).toThrow(/arquivo é um .pfx/);
  });

  it("arquivo que não é PKCS#12 é recusado", () => {
    expect(() => readCertificate(Buffer.from("isto nao e um certificado"), "x")).toThrow();
  });
});

describe("cifragem dos segredos fiscais", () => {
  const original = process.env.FISCAL_ENCRYPTION_KEY;
  beforeEach(() => { process.env.FISCAL_ENCRYPTION_KEY = CHAVE; });
  afterAll(() => { process.env.FISCAL_ENCRYPTION_KEY = original; });

  it("vai e volta preservando os bytes do arquivo binário", () => {
    const secrets = new FiscalSecretsService();
    const { buffer } = gerarCertificado();

    const cifrado = secrets.encrypt(buffer);

    expect(cifrado).not.toContain(buffer.toString("base64"));
    expect(secrets.decryptToBuffer(cifrado).equals(buffer)).toBe(true);
  });

  it("adulterar o texto cifrado é detectado pelo GCM", () => {
    const secrets = new FiscalSecretsService();
    const cifrado = secrets.encrypt("token-do-csc");
    const [v, iv, tag, dados] = cifrado.split(".");
    // Altera um caractere significativo do ciphertext. Trocar apenas o fim
    // do Base64URL pode manter os mesmos bits úteis de um bloco incompleto.
    const primeiroCaractereAlterado = dados.startsWith("A") ? "B" : "A";
    const adulterado = [v, iv, tag, primeiroCaractereAlterado + dados.slice(1)].join(".");

    expect(() => secrets.decrypt(adulterado)).toThrow();
  });

  it("sem chave configurada avisa o que falta em vez de gravar em claro", () => {
    delete process.env.FISCAL_ENCRYPTION_KEY;
    const secrets = new FiscalSecretsService();
    expect(secrets.isConfigured()).toBe(false);
    expect(() => secrets.encrypt("x")).toThrow(/FISCAL_ENCRYPTION_KEY/);
  });
});

describe("cadastro fiscal", () => {
  const original = process.env.FISCAL_ENCRYPTION_KEY;
  beforeEach(() => { process.env.FISCAL_ENCRYPTION_KEY = CHAVE; });
  afterAll(() => { process.env.FISCAL_ENCRYPTION_KEY = original; });

  function build(overrides: any = {}) {
    const certificados: any[] = overrides.certificados ?? [];
    const prisma = {
      companyFiscalProfile: {
        findUnique: jest.fn().mockResolvedValue(overrides.profile ?? null),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "perfil-1", ...data })),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "perfil-1", ...overrides.profile, ...data })),
      },
      fiscalCertificate: {
        findFirst: jest.fn().mockResolvedValue(certificados[0] ?? null),
        findMany: jest.fn().mockResolvedValue(overrides.expirando ?? []),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "cert-1", createdAt: new Date(), ...data })),
      },
      company: { findUnique: jest.fn().mockResolvedValue(overrides.company ?? { cnpj: "12345678000199" }) },
      product: { findMany: jest.fn().mockResolvedValue(overrides.produtos ?? []) },
      user: { findMany: jest.fn().mockResolvedValue(overrides.admins ?? []) },
      $transaction: jest.fn().mockImplementation((fn: any) => fn({
        fiscalCertificate: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "cert-1", createdAt: new Date(), ...data })),
        },
      })),
    };
    const mail = { sendFiscalAlert: jest.fn().mockResolvedValue(undefined) };
    const service = new FiscalService(prisma as never, new FiscalSecretsService(), mail as never);
    service.onModuleDestroy();
    return { service, prisma, mail };
  }

  const dtoValido: any = {
    taxRegime: TaxRegime.SIMPLES_NACIONAL,
    cnae: "5611201",
    stateRegistration: "ISENTO",
    legalName: "Loja Teste Ltda",
    addressStreet: "Rua A",
    addressNumber: "10",
    addressDistrict: "Centro",
    cityIbgeCode: "3106200",
    cityName: "Belo Horizonte",
    state: "MG",
    zipCode: "30130000",
  };

  it("grava o CSC cifrado e nunca o devolve", async () => {
    const { service, prisma } = build();

    const salvo = await service.upsertProfile("empresa-1", {
      ...dtoValido,
      cscId: "000001",
      cscToken: "token-secreto-do-csc",
    });

    const gravado = prisma.companyFiscalProfile.create.mock.calls[0][0].data;
    expect(gravado.cscTokenEncrypted).toMatch(/^v1\./);
    expect(gravado.cscTokenEncrypted).not.toContain("token-secreto-do-csc");
    expect(gravado.cscToken).toBeUndefined();
    expect((salvo as any).cscTokenEncrypted).toBeUndefined();
    expect((salvo as any).hasCscToken).toBe(true);
  });

  it("recusa ligar produção sem certificado e sem CSC", async () => {
    const { service } = build();

    await expect(service.upsertProfile("empresa-1", {
      ...dtoValido,
      environment: FiscalEnvironment.PRODUCAO,
    })).rejects.toThrow(/certificado digital A1/);
  });

  it("aceita produção quando certificado e CSC estão em ordem", async () => {
    const { service } = build({
      certificados: [{
        id: "cert-1",
        notAfter: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        status: FiscalCertificateStatus.ATIVO,
      }],
      profile: { cscId: "000001", cscTokenEncrypted: "v1.a.b.c" },
    });

    await expect(service.upsertProfile("empresa-1", {
      ...dtoValido,
      environment: FiscalEnvironment.PRODUCAO,
    })).resolves.toBeDefined();
  });

  describe("upload do certificado", () => {
    function arquivo(buffer: Buffer, nome = "certificado.pfx") {
      return { originalname: nome, buffer, size: buffer.length };
    }

    it("guarda cifrado, extrai os metadados e não devolve o arquivo", async () => {
      const { service } = build();
      const { buffer, senha } = gerarCertificado();

      const resultado: any = await service.uploadCertificate("empresa-1", "user-1", arquivo(buffer), senha);

      expect(resultado.subjectName).toContain("LOJA TESTE LTDA");
      expect(resultado.daysUntilExpiry).toBeGreaterThan(300);
      expect(resultado.contentEncrypted).toBeUndefined();
      expect(resultado.passwordEncrypted).toBeUndefined();
    });

    it("recusa certificado de outro CNPJ", async () => {
      const { service } = build({ company: { cnpj: "99999999000199" } });
      const { buffer, senha } = gerarCertificado();

      await expect(service.uploadCertificate("empresa-1", "user-1", arquivo(buffer), senha))
        .rejects.toThrow(/CNPJ do certificado/);
    });

    it("recusa extensão que não seja .pfx ou .p12", async () => {
      const { service } = build();
      const { buffer, senha } = gerarCertificado();

      await expect(service.uploadCertificate("empresa-1", "user-1", arquivo(buffer, "cert.pem"), senha))
        .rejects.toThrow(/\.pfx ou \.p12/);
    });

    it("recusa arquivo ausente", async () => {
      const { service } = build();
      await expect(service.uploadCertificate("empresa-1", "user-1", undefined, "x"))
        .rejects.toThrow(/Envie o arquivo/);
    });

    it("marca o certificado anterior como substituído em vez de apagar", async () => {
      const { service, prisma } = build();
      const { buffer, senha } = gerarCertificado();

      await service.uploadCertificate("empresa-1", "user-1", arquivo(buffer), senha);

      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe("alerta de validade", () => {
    it("avisa os administradores e não repete na rodada seguinte", async () => {
      const vencendo = {
        id: "cert-1",
        companyId: "empresa-1",
        subjectName: "LOJA TESTE LTDA",
        notAfter: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        company: { id: "empresa-1", name: "Loja Teste" },
      };
      const { service, mail, prisma } = build({
        expirando: [vencendo],
        admins: [{ email: "admin@loja.com" }, { email: "socio@loja.com" }],
      });

      await service.alertExpiringCertificates();

      expect(mail.sendFiscalAlert).toHaveBeenCalledTimes(2);
      expect(prisma.fiscalCertificate.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { expiryAlertedAt: expect.any(Date) } }),
      );
      const [, assunto] = mail.sendFiscalAlert.mock.calls[0];
      expect(assunto).toContain("vence em");
    });

    it("quem não reivindicou não envia nada", async () => {
      const { service, mail, prisma } = build({
        expirando: [{
          id: "cert-1",
          companyId: "empresa-1",
          subjectName: "X",
          notAfter: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          company: { id: "empresa-1", name: "Loja" },
        }],
        admins: [{ email: "admin@loja.com" }],
      });
      prisma.fiscalCertificate.updateMany.mockResolvedValue({ count: 0 });

      await service.alertExpiringCertificates();

      expect(mail.sendFiscalAlert).not.toHaveBeenCalled();
    });

    it("certificado já vencido avisa que a emissão está bloqueada", async () => {
      const { service, mail } = build({
        expirando: [{
          id: "cert-1",
          companyId: "empresa-1",
          subjectName: "X",
          notAfter: new Date(Date.now() - 24 * 60 * 60 * 1000),
          company: { id: "empresa-1", name: "Loja" },
        }],
        admins: [{ email: "admin@loja.com" }],
      });

      await service.alertExpiringCertificates();

      const [, assunto, linhas] = mail.sendFiscalAlert.mock.calls[0];
      expect(assunto).toContain("vencido");
      expect(linhas.join(" ")).toContain("bloqueada");
    });
  });

  describe("validação dos padrões fiscais", () => {
    it("recusa CST de ICMS em empresa do Simples", async () => {
      const { service } = build();

      await expect(service.upsertProfile("empresa-1", { ...dtoValido, defaultIcmsCode: "00" }))
        .rejects.toThrow(/use CSOSN, não CST/);
    });

    it("recusa CSOSN em empresa de regime normal", async () => {
      const { service } = build();

      await expect(service.upsertProfile("empresa-1", {
        ...dtoValido,
        taxRegime: TaxRegime.REGIME_NORMAL,
        defaultIcmsCode: "102",
      })).rejects.toThrow(/use CST, não CSOSN/);
    });

    it("recusa CFOP fora da lista de venda ao consumidor", async () => {
      const { service } = build();

      await expect(service.upsertProfile("empresa-1", { ...dtoValido, defaultCfop: "6102" }))
        .rejects.toThrow(/CFOP/);
    });

    it("recusa CST de PIS inexistente", async () => {
      const { service } = build();

      await expect(service.upsertProfile("empresa-1", { ...dtoValido, defaultPisCode: "99" }))
        .rejects.toThrow(/CST de PIS/);
    });
  });

  describe("situação fiscal do cardápio", () => {
    const perfilCompleto = {
      taxRegime: TaxRegime.SIMPLES_NACIONAL,
      defaultNcm: "21069090",
      defaultCest: null,
      defaultCfop: "5102",
      defaultTaxOrigin: "NACIONAL",
      defaultIcmsCode: "102",
      defaultIcmsRate: null,
      defaultPisCode: "49",
      defaultPisRate: 0,
      defaultCofinsCode: "49",
      defaultCofinsRate: 0,
      defaultUnit: "UN",
    };
    const vazio = {
      ncm: null, cest: null, cfop: null, taxOrigin: null, icmsCode: null, icmsRate: null,
      pisCode: null, pisRate: null, cofinsCode: null, cofinsRate: null, unit: null,
    };

    it("conta os produtos que ainda não podem sair numa nota", async () => {
      const { service } = build({
        profile: { ...perfilCompleto, defaultNcm: null },
        produtos: [
          { id: "p1", name: "Prato", ...vazio },
          { id: "p2", name: "Cerveja", ...vazio, ncm: "22030000" },
        ],
      });

      const resultado = await service.listProductTaxStatus("empresa-1");

      expect(resultado.total).toBe(2);
      expect(resultado.pending).toBe(1);
      expect(resultado.items.find((i: any) => i.id === "p2")?.ready).toBe(true);
    });

    it("onlyPending devolve só o que impede a emissão", async () => {
      const { service } = build({
        profile: perfilCompleto,
        produtos: [
          { id: "p1", name: "Prato", ...vazio },
          { id: "p2", name: "Errado", ...vazio, cfop: "6102" },
        ],
      });

      const resultado = await service.listProductTaxStatus("empresa-1", { onlyPending: true });

      expect(resultado.items).toHaveLength(1);
      expect(resultado.items[0].name).toBe("Errado");
    });

    it("a prontidão geral reflete produtos pendentes", async () => {
      const { service } = build({
        profile: perfilCompleto,
        certificados: [{
          id: "cert-1",
          notAfter: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000),
          status: FiscalCertificateStatus.ATIVO,
        }],
        produtos: [{ id: "p1", name: "Prato", ...vazio, cfop: "6102" }],
      });

      const resultado = await service.getProfile("empresa-1");

      expect(resultado.products).toEqual({ total: 1, pending: 1 });
      expect(resultado.readiness.pendencias.join(" ")).toContain("1 produto(s) sem tributação completa");
      expect(resultado.readiness.canEmitInProduction).toBe(false);
    });
  });

  describe("prontidão", () => {
    it("lista o que falta quando nada foi cadastrado", async () => {
      const { service } = build();

      const resultado = await service.getProfile("empresa-1");

      expect(resultado.readiness.canEmitInProduction).toBe(false);
      expect(resultado.readiness.pendencias).toEqual(
        expect.arrayContaining([
          "Cadastro fiscal não preenchido.",
          "Certificado digital A1 não enviado.",
        ]),
      );
    });

    it("avisa quando o certificado está perto de vencer", async () => {
      const { service } = build({
        profile: { environment: FiscalEnvironment.PRODUCAO, cscId: "000001", cscTokenEncrypted: "v1.a.b.c" },
        certificados: [{
          id: "cert-1",
          notAfter: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          status: FiscalCertificateStatus.ATIVO,
        }],
      });

      const resultado = await service.getProfile("empresa-1");

      expect(resultado.readiness.pendencias.join(" ")).toMatch(/vence em \d+ dia/);
      expect(resultado.readiness.canEmitInProduction).toBe(false);
    });
  });
});
