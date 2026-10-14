import { BadRequestException } from "@nestjs/common";
import { DeliveryStatus } from "@prisma/client";
import { isValidBrazilDocument } from "../src/common/validators/brazil-document.validator";
import { DeliveriesService } from "../src/deliveries/deliveries.service";
import { businessDayRange } from "../src/common/utils/business-date";
import { isStoreOpen } from "../src/common/utils/store-hours";
import { OrdersService } from "../src/orders/orders.service";

describe("Regras críticas de domínio", () => {
  const deliveries = new DeliveriesService({} as never, {} as never, {} as never);
  const assertTransition = (
    current: DeliveryStatus,
    next: DeliveryStatus,
    statusBeforeProblem: DeliveryStatus | null = null,
  ) => {
    (deliveries as any).assertValidTransition(
      { status: current, statusBeforeProblem },
      next,
    );
  };

  it("valida CPF e CNPJ pelos dígitos verificadores", () => {
    expect(isValidBrazilDocument("529.982.247-25")).toBe(true);
    expect(isValidBrazilDocument("11.222.333/0001-81")).toBe(true);
    expect(isValidBrazilDocument("111.111.111-11")).toBe(false);
    expect(isValidBrazilDocument("11.222.333/0001-82")).toBe(false);
    // Primeira inscrição alfanumérica divulgada pela Receita Federal em 2026.
    expect(isValidBrazilDocument("00.000.000/E08G-12")).toBe(true);
    expect(isValidBrazilDocument("00.000.000/E08G-13")).toBe(false);
  });

  it("mantém a entrega no fluxo sequencial", () => {
    expect(() => assertTransition(
      DeliveryStatus.AGUARDANDO_RETIRADA,
      DeliveryStatus.RETIRADO,
    )).not.toThrow();
    expect(() => assertTransition(
      DeliveryStatus.AGUARDANDO_RETIRADA,
      DeliveryStatus.ENTREGUE,
    )).toThrow(BadRequestException);
  });

  it("permite registrar problema a partir de uma entrega em aberto", () => {
    expect(() => assertTransition(
      DeliveryStatus.EM_ROTA,
      DeliveryStatus.PROBLEMA,
    )).not.toThrow();
  });

  it("só resolve um incidente retomando a etapa anterior", () => {
    expect(() => assertTransition(
      DeliveryStatus.PROBLEMA,
      DeliveryStatus.EM_ROTA,
      DeliveryStatus.EM_ROTA,
    )).not.toThrow();
    expect(() => assertTransition(
      DeliveryStatus.PROBLEMA,
      DeliveryStatus.ENTREGUE,
      DeliveryStatus.EM_ROTA,
    )).toThrow(BadRequestException);
  });

  it("impede alteração de entrega concluída", () => {
    expect(() => assertTransition(
      DeliveryStatus.ENTREGUE,
      DeliveryStatus.PROBLEMA,
    )).toThrow(BadRequestException);
  });

  it("separa o fluxo por dia no fuso horário da operação", () => {
    const range = businessDayRange("2026-07-31", "America/Sao_Paulo");
    expect(range.start.toISOString()).toBe("2026-07-31T03:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-08-01T03:00:00.000Z");
  });

  it("recusa uma data inexistente no fluxo", () => {
    expect(() => businessDayRange("2026-02-30", "America/Sao_Paulo"))
      .toThrow(BadRequestException);
  });

  it("usa o horário salvo da loja no fuso de São Paulo", () => {
    const openingHours = { sexta: "18:00-00:00" };
    expect(isStoreOpen(openingHours, new Date("2026-07-31T15:00:00.000Z"), "America/Sao_Paulo"))
      .toBe(false);
    expect(isStoreOpen(openingHours, new Date("2026-07-31T21:00:00.000Z"), "America/Sao_Paulo"))
      .toBe(true);
  });

  it("calcula entrega pela distância da rota, sem depender de bairro pré-cadastrado", async () => {
    const geography = {
      calculateDrivingRoute: jest.fn().mockResolvedValue({ distanceKm: 2.4, durationMinutes: 9 }),
    };
    const orders = new OrdersService({} as never, {} as never, geography as never, { emitForOrder: jest.fn() } as never);
    const quote = await (orders as any).calculateDeliveryQuote(
      { latitude: -23.56, longitude: -46.65, zipCode: "01001000", deliveryRadiusKm: 10, deliveryFeeBase: 6.9, deliveryFeePerKm: 1.5 },
      { latitude: -23.57, longitude: -46.66, zipCode: "01002000" },
    );

    expect(quote).toEqual({ distanceKm: 2.4, durationMinutes: 9, deliveryFee: 10.5 });
  });

  it("recusa uma rota acima do raio configurado da loja", async () => {
    const geography = {
      calculateDrivingRoute: jest.fn().mockResolvedValue({ distanceKm: 10.01, durationMinutes: 30 }),
    };
    const orders = new OrdersService({} as never, {} as never, geography as never, { emitForOrder: jest.fn() } as never);

    await expect((orders as any).calculateDeliveryQuote(
      { latitude: -23.56, longitude: -46.65, zipCode: "01001000", deliveryRadiusKm: 10, deliveryFeeBase: 6.9, deliveryFeePerKm: 1.5 },
      { latitude: -23.57, longitude: -46.66, zipCode: "01002000" },
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it("cota entrega para qualquer loja usando os CEPs quando os dois endereços não são indexados", async () => {
    const geography = {
      geocode: jest.fn().mockRejectedValue(new BadRequestException("Endereço não localizado")),
      calculateDrivingRoute: jest.fn().mockResolvedValue({ distanceKm: 2.4, durationMinutes: 9 }),
    };
    const postalCodeLocations = {
      resolve: jest.fn().mockImplementation(async (zipCode: string) => zipCode === "74968190"
        ? { latitude: -16.8201544, longitude: -49.2645848 }
        : { latitude: -16.825, longitude: -49.267 }),
    };
    const orders = new OrdersService(
      {} as never,
      {} as never,
      geography as never,
      {} as never,
      undefined,
      postalCodeLocations as never,
    );
    const quote = await (orders as any).calculateDeliveryQuote(
      {
        addressLine: "Rua da Loja, 10", city: "Aparecida de Goiânia", state: "GO",
        zipCode: "74968000", deliveryRadiusKm: 10, deliveryFeeBase: 6.9, deliveryFeePerKm: 1.5,
      },
      {
        street: "Rua Guarapari", number: "0", neighborhood: "Jardim Ipiranga",
        city: "Aparecida de Goiânia", state: "GO", zipCode: "74968190",
      },
    );

    expect(quote).toEqual({
      distanceKm: 2.4,
      durationMinutes: 9,
      deliveryFee: 10.5,
      estimatedByPostalCode: true,
    });
    expect(postalCodeLocations.resolve).toHaveBeenCalledTimes(2);
    expect(geography.calculateDrivingRoute).toHaveBeenCalledWith(
      { latitude: -16.825, longitude: -49.267, estimatedByPostalCode: true },
      { latitude: -16.8201544, longitude: -49.2645848, estimatedByPostalCode: true },
    );
  });

  it("aceita uma pizza com quantidade dinâmica de sabores e cobra somente o maior adicional", () => {
    const orders = new OrdersService({} as never, {} as never, {} as never, {} as never);
    const pizza = {
      name: "Pizza especial",
      optionGroups: [
        {
          id: "tamanho",
          name: "Tamanho",
          minSelections: 1,
          maxSelections: 1,
          pricingRule: "SUM",
          options: [
            { id: "media", name: "Média", priceDelta: 0 },
            { id: "grande", name: "Grande", priceDelta: 10 },
          ],
        },
        {
          id: "sabores",
          name: "Sabores",
          minSelections: 1,
          maxSelections: 3,
          pricingRule: "HIGHEST",
          options: [
            { id: "mussarela", name: "Mussarela", priceDelta: 4 },
            { id: "calabresa", name: "Calabresa", priceDelta: 7 },
            { id: "camarão", name: "Camarão", priceDelta: 12 },
          ],
        },
      ],
    };

    const result = (orders as any).resolveProductOptionSelections(pizza, [
      { groupId: "tamanho", optionIds: ["grande"] },
      { groupId: "sabores", optionIds: ["mussarela", "calabresa", "camarão"] },
    ]);

    expect(result.totalPriceDelta).toBe(22);
    expect(result.optionSelections).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupName: "Sabores", pricingRule: "HIGHEST", priceDelta: 12 }),
    ]));
  });

  it("exige os grupos obrigatórios configurados pelo estabelecimento", () => {
    const orders = new OrdersService({} as never, {} as never, {} as never, {} as never);
    const product = {
      name: "Prato montável",
      optionGroups: [{
        id: "ponto",
        name: "Ponto da carne",
        minSelections: 1,
        maxSelections: 1,
        pricingRule: "SUM",
        options: [{ id: "ao-ponto", name: "Ao ponto", priceDelta: 0 }],
      }],
    };

    expect(() => (orders as any).resolveProductOptionSelections(product, []))
      .toThrow(/Ponto da carne/i);
  });
});
