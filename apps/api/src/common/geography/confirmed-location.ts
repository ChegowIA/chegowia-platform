import { BadRequestException } from "@nestjs/common";

/** Só um ponto escolhido explicitamente no mapa pode ser tratado como destino confirmado. */
export function confirmedLocationPatch(
  input: { latitude?: number | null; longitude?: number | null },
  addressChanged: boolean,
) {
  const hasLatitude = input.latitude !== undefined;
  const hasLongitude = input.longitude !== undefined;
  if (hasLatitude !== hasLongitude) {
    throw new BadRequestException("Confirme latitude e longitude juntas no mapa.");
  }
  if (hasLatitude && hasLongitude) {
    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    // O cadastro é exclusivo para operações brasileiras. Coordenadas fora do
    // país normalmente indicam erro de formato ou tentativa de forçar frete.
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -34 || latitude > 6 || longitude < -75 || longitude > -30) {
      throw new BadRequestException("Selecione um ponto válido no Brasil para a entrega.");
    }
    return { latitude, longitude, locationConfirmedAt: new Date() };
  }
  return addressChanged
    ? { latitude: null, longitude: null, locationConfirmedAt: null }
    : {};
}
