import { ForbiddenException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { TemporaryTestModeService, normalizeIp } from "../src/common/test-mode/test-mode.service";

describe("modo temporário de homologação", () => {
  const original = {
    enabled: process.env.TEMP_TEST_MODE_ENABLED,
    ips: process.env.TEMP_TEST_ALLOWED_CREATION_IPS,
    email: process.env.TEMP_TEST_CATALOG_EMAIL,
  };

  afterEach(() => {
    restore("TEMP_TEST_MODE_ENABLED", original.enabled);
    restore("TEMP_TEST_ALLOWED_CREATION_IPS", original.ips);
    restore("TEMP_TEST_CATALOG_EMAIL", original.email);
  });

  it("normaliza IPv4 recebido por proxy IPv6", () => {
    expect(normalizeIp("::ffff:203.0.113.8")).toBe("203.0.113.8");
    expect(normalizeIp("203.0.113.8")).toBe("203.0.113.8");
    expect(normalizeIp("forjado, 203.0.113.8")).toBe("");
  });

  it("restringe criação ao IP configurado enquanto o modo está ativo", () => {
    process.env.TEMP_TEST_MODE_ENABLED = "true";
    process.env.TEMP_TEST_ALLOWED_CREATION_IPS = "203.0.113.8";
    const service = new TemporaryTestModeService({ user: { findFirst: jest.fn() } } as never);

    expect(() => service.assertCreationAllowed({ ip: "203.0.113.8" } as never, "empresa")).not.toThrow();
    expect(() => service.assertCreationAllowed({ ip: "203.0.113.9" } as never, "revendedor"))
      .toThrow(ForbiddenException);
  });

  it("só expõe empresas de teste ao CLIENTE autorizado no banco", async () => {
    process.env.TEMP_TEST_MODE_ENABLED = "true";
    process.env.TEMP_TEST_CATALOG_EMAIL = "thiagolpssouza@gmail.com";
    const findFirst = jest.fn().mockResolvedValue({ id: "cliente-autorizado" });
    const service = new TemporaryTestModeService({ user: { findFirst } } as never);

    await expect(service.publicCompanyVisibilityWhere()).resolves.toEqual({ isTestOnly: false });
    await expect(service.publicCompanyVisibilityWhere({
      sub: "cliente-autorizado",
      email: "thiagolpssouza@gmail.com",
      role: Role.CLIENTE,
      companyId: null,
    })).resolves.toEqual({});

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "cliente-autorizado",
        email: "thiagolpssouza@gmail.com",
        role: Role.CLIENTE,
        isActive: true,
      },
      select: { id: true },
    });
  });
});

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
