import { Role } from "@prisma/client";
import { LegacyTestDataService } from "../src/common/legacy-test-data/legacy-test-data.service";

describe("dados legados da homologação", () => {
  const service = new LegacyTestDataService();

  it("mantém empresas isTestOnly fora das superfícies públicas para qualquer pessoa", () => {
    expect(service.publicCompanyVisibilityWhere()).toEqual({ isTestOnly: false });
    expect(service.publicCompanyVisibilityWhere({
      sub: "cliente-antigo",
      email: "cliente-legado@example.test",
      role: Role.CLIENTE,
      companyId: null,
    })).toEqual({ isTestOnly: false });
  });

  it("não recria exceções por IP, e-mail ou por usuário após encerrar a homologação", () => {
    expect(service.publicCompanyVisibilityWhereForUserId("cliente-antigo"))
      .toEqual({ isTestOnly: false });
    expect(service.publicCompanyVisibilityWhereForUserId(null))
      .toEqual({ isTestOnly: false });
  });
});
