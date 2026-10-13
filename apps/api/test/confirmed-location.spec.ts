import { BadRequestException } from "@nestjs/common";
import { confirmedLocationPatch } from "../src/common/geography/confirmed-location";
import { OrdersService } from "../src/orders/orders.service";

describe("localização confirmada de entregas", () => {
  it("só grava o ponto quando latitude e longitude vierem juntas", () => {
    expect(() => confirmedLocationPatch({ latitude: -16.82 }, false)).toThrow(BadRequestException);
    expect(() => confirmedLocationPatch({ latitude: 40, longitude: -49.26 }, false)).toThrow(BadRequestException);
    expect(confirmedLocationPatch({}, true)).toEqual({
      latitude: null,
      longitude: null,
      locationConfirmedAt: null,
    });
    expect(confirmedLocationPatch({ latitude: -16.82, longitude: -49.26 }, true)).toEqual({
      latitude: -16.82,
      longitude: -49.26,
      locationConfirmedAt: expect.any(Date),
    });
  });

  it("não deixa uma cotação do site usar ponto automático pelo CEP como se fosse exato", () => {
    const orders = new OrdersService({} as never, {} as never, {} as never, {} as never);
    const pinned = { latitude: -16.82, longitude: -49.26, locationConfirmedAt: new Date() };
    expect(() => (orders as any).assertConfirmedSiteLocations(
      { latitude: null, longitude: null }, pinned,
    )).toThrow("A loja precisa confirmar");
    expect(() => (orders as any).assertConfirmedSiteLocations(
      pinned, { latitude: -16.82, longitude: -49.26 },
    )).toThrow("Confirme no mapa");
    expect(() => (orders as any).assertConfirmedSiteLocations(pinned, pinned)).not.toThrow();
  });
});
