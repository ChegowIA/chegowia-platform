import { PaymentMethod } from "@prisma/client";
import { CompaniesService } from "../src/companies/companies.service";

describe("persistência das configurações da empresa", () => {
  const currentCompany = {
    id: "company-1",
    name: "Pizzaria antiga",
    slug: "pizzaria-antiga",
    cnpj: null,
    addressLine: "Rua 1, 1",
    city: "Goiânia",
    state: "GO",
    zipCode: "74013010",
    latitude: -16.6784,
    longitude: -49.2563,
    deliveryFeeBase: 6,
    deliveryFeePerKm: 1.5,
    deliveryRadiusKm: 12,
    avgDeliveryTimeMinutes: 40,
    settings: {
      openingHours: { segunda: "18:00-23:00" },
      paymentMethodsEnabled: [PaymentMethod.PIX_MANUAL],
      aiEnabled: true,
      aiKnowledgeBase: "Cardápio antigo",
      whatsappNumber: "5562000000000",
    },
  };

  function createService() {
    const updatedCompany = {
      ...currentCompany,
      addressLine: "Rua Guarapari, 100",
      city: "Aparecida de Goiânia",
      zipCode: "74968190",
      latitude: null,
      longitude: null,
    };
    const transaction = {
      company: { update: jest.fn().mockResolvedValue(updatedCompany) },
      identityDocument: { deleteMany: jest.fn(), create: jest.fn() },
    };
    const prisma = {
      company: { findUnique: jest.fn().mockResolvedValue(currentCompany) },
      companySettings: { upsert: jest.fn().mockResolvedValue({ companyId: currentCompany.id }) },
      $transaction: jest.fn((work: (tx: typeof transaction) => unknown) => work(transaction)),
    };
    const postalCodeLocations = { warm: jest.fn() };
    return {
      service: new CompaniesService(prisma as never, {} as never, {} as never, postalCodeLocations as never),
      prisma,
      transaction,
      postalCodeLocations,
      updatedCompany,
    };
  }

  it("grava endereço, CEP, taxas e raio; ao trocar localização invalida coordenadas antigas", async () => {
    const { service, transaction, postalCodeLocations, updatedCompany } = createService();

    await expect(service.updateMyCompany("company-1", {
      name: "Pizzaria atualizada",
      addressLine: "Rua Guarapari, 100",
      city: "Aparecida de Goiânia",
      state: "GO",
      zipCode: "74968-190",
      deliveryFeeBase: 7,
      deliveryFeePerKm: 2,
      deliveryRadiusKm: 15,
      avgDeliveryTimeMinutes: 35,
    })).resolves.toEqual(updatedCompany);

    expect(transaction.company.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "company-1" },
      data: expect.objectContaining({
        addressLine: "Rua Guarapari, 100",
        city: "Aparecida de Goiânia",
        state: "GO",
        zipCode: "74968190",
        deliveryFeeBase: 7,
        deliveryFeePerKm: 2,
        deliveryRadiusKm: 15,
        avgDeliveryTimeMinutes: 35,
        latitude: null,
        longitude: null,
      }),
      include: { settings: true },
    }));
    expect(postalCodeLocations.warm).toHaveBeenCalledWith("74968190", {
      city: "Aparecida de Goiânia",
      state: "GO",
    });
  });

  it("salva horários, pagamentos e preferências da IA sem apagar os outros dados", async () => {
    const { service, prisma } = createService();
    const settings = {
      openingHours: { segunda: "18:00-00:00" },
      paymentMethodsEnabled: [PaymentMethod.PIX_MANUAL, PaymentMethod.DINHEIRO],
      aiEnabled: false,
      aiKnowledgeBase: "Nova política da loja",
      whatsappNumber: "5562999999999",
    };

    await service.updateSettings("company-1", settings);

    expect(prisma.companySettings.upsert).toHaveBeenCalledWith({
      where: { companyId: "company-1" },
      create: { companyId: "company-1", ...settings },
      update: settings,
    });
  });
});
