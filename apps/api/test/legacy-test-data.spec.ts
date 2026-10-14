import { Role } from "@prisma/client";
import { LegacyTestDataService } from "../src/common/legacy-test-data/legacy-test-data.service";

describe("dados legados da homologação", () => {
  const targetViewer = {
    sub: "thiago-user",
    email: "thiagolpssouza@gmail.com",
    role: Role.CLIENTE,
    companyId: null,
  };

  function createService(options: {
    userEmail?: string;
    address?: any;
    company?: any;
    descendants?: any[];
    postalMatch?: boolean;
  } = {}) {
    const address = options.address === undefined
      ? {
        id: "address-1",
        street: "Rua 1",
        number: "100",
        complement: null,
        neighborhood: "Setor Central",
        city: "Goiânia",
        state: "GO",
        zipCode: "74013010",
        latitude: -16.68,
        longitude: -49.25,
      }
      : options.address;
    const company = options.company === undefined
      ? {
        id: "demo-company",
        slug: "operacao-demo-chegowia",
        isActive: true,
        isTestOnly: true,
        addressLine: "Rua 1, 1",
        city: "Goiânia",
        state: "GO",
        zipCode: "74013010",
        latitude: -16.67,
        longitude: -49.24,
        deliveryRadiusKm: 12,
        deliveryAreas: [],
      }
      : options.company;
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ email: options.userEmail ?? targetViewer.email }) },
      address: {
        findFirst: jest.fn().mockResolvedValue(address),
        update: jest.fn().mockResolvedValue(address),
      },
      company: {
        findFirst: jest.fn().mockResolvedValue(company),
        findMany: jest.fn().mockResolvedValue(options.descendants ?? []),
        update: jest.fn().mockResolvedValue(company),
      },
    };
    const postalCodeLocations = {
      isLikelyWithinDeliveryRadius: jest.fn().mockResolvedValue(options.postalMatch ?? true),
    };
    return {
      service: new LegacyTestDataService(prisma as never, postalCodeLocations as never),
      prisma,
      postalCodeLocations,
    };
  }

  it("mantém empresas isTestOnly fora das superfícies públicas para visitantes e outras contas", async () => {
    const { service, prisma } = createService();
    await expect(service.publicCompanyVisibilityWhere()).resolves.toEqual({ isTestOnly: false });
    await expect(service.publicCompanyVisibilityWhere({
      sub: "cliente-antigo",
      email: "cliente-legado@example.test",
      role: Role.CLIENTE,
      companyId: null,
    })).resolves.toEqual({ isTestOnly: false });
    expect(prisma.address.findFirst).not.toHaveBeenCalled();
  });

  it("libera somente a demo para a conta autorizada quando o CEP está dentro do raio médio", async () => {
    const { service, postalCodeLocations } = createService();

    await expect(service.publicCompanyVisibilityWhere(targetViewer)).resolves.toEqual({
      OR: [
        { isTestOnly: false },
        { id: { in: ["demo-company"] }, isTestOnly: true },
      ],
    });
    expect(postalCodeLocations.isLikelyWithinDeliveryRadius).toHaveBeenCalledWith(expect.objectContaining({
      customerZipCode: "74013010",
      companyZipCode: "74013010",
      deliveryRadiusKm: 12,
    }));
  });

  it("oculta a demo quando a triagem de CEP informa que o endereço está fora do raio", async () => {
    const { service } = createService({ postalMatch: false });
    await expect(service.publicCompanyVisibilityWhere(targetViewer)).resolves.toEqual({ isTestOnly: false });
  });

  it("não confia apenas no e-mail de um token antigo quando a conta mudou de endereço de e-mail", async () => {
    const { service } = createService({ userEmail: "outra.pessoa@example.com" });
    await expect(service.publicCompanyVisibilityWhere(targetViewer)).resolves.toEqual({ isTestOnly: false });
  });

  it("permite a demo na cidade vizinha quando o CEP está dentro do raio médio", async () => {
    const { service, postalCodeLocations } = createService({
      address: {
        id: "address-1",
        street: "Rua 1",
        number: "100",
        neighborhood: "Centro",
        city: "Aparecida de Goiânia",
        state: "GO",
        zipCode: "74968190",
      },
    });
    await expect(service.publicCompanyVisibilityWhere(targetViewer)).resolves.toEqual(expect.objectContaining({ OR: expect.any(Array) }));
    expect(postalCodeLocations.isLikelyWithinDeliveryRadius).toHaveBeenCalledTimes(1);
  });

  it("mantém a exceção da demo fora do filtro textual de cidade do catálogo", async () => {
    const { service } = createService({
      address: {
        id: "address-1",
        street: "Rua 1",
        number: "100",
        neighborhood: "Centro",
        city: "Aparecida de Goiânia",
        state: "GO",
        zipCode: "74968190",
      },
    });
    await expect(service.publicCatalogCompanyScope(targetViewer, "Aparecida de Goiânia")).resolves.toEqual({
      OR: [
        expect.objectContaining({ isTestOnly: false }),
        expect.objectContaining({ id: { in: ["demo-company"] }, isTestOnly: true }),
      ],
    });
  });

  it("confere o e-mail no banco quando a superfície conhece apenas o id do usuário", async () => {
    const { service, prisma } = createService();
    await expect(service.publicCompanyVisibilityWhereForUserId(targetViewer.sub)).resolves.toEqual(expect.objectContaining({ OR: expect.any(Array) }));
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: targetViewer.sub },
      select: { email: true },
    });

    const other = createService({ userEmail: "outra.pessoa@example.com" });
    await expect(other.service.publicCompanyVisibilityWhereForUserId("outra-conta"))
      .resolves.toEqual({ isTestOnly: false });
  });

  it("mostra descendentes demo apenas à conta autorizada e somente dentro do raio de cada unidade", async () => {
    const descendants = [
      { id: "demo-filial-perto", zipCode: "74013010", city: "Goiânia", state: "GO", deliveryRadiusKm: 8 },
      { id: "demo-filial-longe", zipCode: "74800000", city: "Goiânia", state: "GO", deliveryRadiusKm: 8 },
    ];
    const { service, prisma, postalCodeLocations } = createService({ descendants });
    postalCodeLocations.isLikelyWithinDeliveryRadius
      .mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(service.publicCompanyVisibilityWhere(targetViewer)).resolves.toEqual({ OR: [
      { isTestOnly: false },
      { id: { in: ["demo-company", "demo-filial-perto"] }, isTestOnly: true },
    ] });
    expect(prisma.company.findMany).toHaveBeenCalledWith({
      where: { demoRootCompanyId: "demo-company", isActive: true, isTestOnly: true },
    });
    await expect(service.publicCompanyVisibilityWhere({ ...targetViewer, email: "outro@example.com" }))
      .resolves.toEqual({ isTestOnly: false });
  });
});
