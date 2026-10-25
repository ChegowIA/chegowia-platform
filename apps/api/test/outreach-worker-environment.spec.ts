import { MODULE_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { validateOutreachWorkerEnvironment } from "../src/common/config/outreach-worker-environment.validation";
import { PlatformOutreachService } from "../src/messaging/platform-outreach.service";

const minimal = {
  NODE_ENV: "production",
  APP_ROLE: "outreach-worker",
  DATABASE_URL: "mysql://user:password@mysql:3306/chegowia",
  DEEPSEEK_API_KEY: `sk-${"a".repeat(32)}`,
  OUTREACH_SESSION_ENCRYPTION_KEY: "ab".repeat(32),
};

describe("ambiente mínimo da prospecção", () => {
  it("inicia sem segredos da API operacional", () => {
    expect(validateOutreachWorkerEnvironment(minimal)).toEqual(minimal);
  });

  it("exige os três valores efetivamente utilizados", () => {
    for (const key of ["DATABASE_URL", "DEEPSEEK_API_KEY", "OUTREACH_SESSION_ENCRYPTION_KEY"]) {
      expect(() => validateOutreachWorkerEnvironment({ ...minimal, [key]: "" })).toThrow(key);
    }
  });

  it("rejeita papel incorreto, banco não MySQL e chave inválida", () => {
    expect(() => validateOutreachWorkerEnvironment({ ...minimal, APP_ROLE: "api" })).toThrow("APP_ROLE");
    expect(() => validateOutreachWorkerEnvironment({ ...minimal, DATABASE_URL: "postgresql://localhost/db" })).toThrow("mysql://");
    expect(() => validateOutreachWorkerEnvironment({ ...minimal, OUTREACH_SESSION_ENCRYPTION_KEY: "curta" })).toThrow("64 caracteres");
  });

  it("monta somente os serviços de prospecção sem módulos operacionais", async () => {
    const previous = Object.fromEntries(Object.keys(minimal).map((key) => [key, process.env[key]]));
    try {
      Object.assign(process.env, minimal);
      // ConfigModule.forRoot valida durante a avaliação do módulo.
      const { OutreachWorkerModule } = require("../src/outreach-worker.module");
      const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, OutreachWorkerModule) as Array<{ name?: string; module?: { name?: string } }>;
      const names = imports.map((item) => item.module?.name ?? item.name);
      expect(names).toContain("PrismaModule");
      for (const name of ["AppModule", "MessagingModule", "AiModule", "RealtimeModule"]) {
        expect(names).not.toContain(name);
      }
      const moduleRef = await Test.createTestingModule({ imports: [OutreachWorkerModule] }).compile();
      expect(moduleRef.get(PlatformOutreachService)).toBeDefined();
      await moduleRef.close();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
