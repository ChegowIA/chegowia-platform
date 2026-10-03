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
    postalMatch?: boolean;
    routeDistanceKm?: number;
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
        update: jest.fn().mockResolvedValue(company),
      },
    };
    const geography = {
      geocode: jest.fn(),
      calculateDrivingRoute: jest.fn().mockResolvedValue({
        distanceKm: options.routeDistanceKm ?? 4.2,
        durationMinutes: 14,
      }),
    };
    const postalCodeLocations = {
      isLikelyWithinDeliveryRadius: jest.fn().mockResolvedValue(options.postalMatch ?? true),
    };
    return {
      service: new LegacyTestDataService(prisma as never, geography as never, postalCodeLocations as never),
      prisma,
      geography,
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

  it("libera somente a demo para a conta autorizada quando CEP e rota estão dentro do raio", async () => {
    const { service, postalCodeLocations, geography } = createService();

    await expect(service.publicCompanyVisibilityWhere(targetViewer)).resolves.toEqual({
      OR: [
        { isTestOnly: false },
        { slug: "operacao-demo-chegowia", isTestOnly: true },
      ],
    });
    expect(postalCodeLocations.isLikelyWithinDeliveryRadius).toHaveBeenCalledWith(expect.objectContaining({
      customerZipCode: "74013010",
      companyZipCode: "74013010",
      deliveryRadiusKm: 12,
    }));
    expect(geography.calculateDrivingRoute).toHaveBeenCalledTimes(1);
  });

  it("oculta a demo se a rota real exceder o raio, mesmo para a conta autorizada", async () => {
    const { service } = createService({ routeDistanceKm: 12.01 });
    await expect(service.publicCompanyVisibilityWhere(targetViewer)).resolves.toEqual({ isTestOnly: false });
  });

  it("não consulta rota quando a cidade/área atendida não corresponde ao endereço salvo", async () => {
    const { service, geography, postalCodeLocations } = createService({
      address: {
        id: "address-1",
        street: "Rua 1",
        number: "100",
        neighborhood: "Centro",
        city: "Anápolis",
        state: "GO",
        zipCode: "75000000",
      },
    });
    await expect(service.publicCompanyVisibilityWhere(targetViewer)).resolves.toEqual({ isTestOnly: false });
    expect(postalCodeLocations.isLikelyWithinDeliveryRadius).not.toHaveBeenCalled();
    expect(geography.calculateDrivingRoute).not.toHaveBeenCalled();
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
});
