interface DeliveryAddress {
  deliveryStreet: string | null;
  deliveryNumber: string | null;
  deliveryComplement?: string | null;
  deliveryNeighborhood: string | null;
  deliveryCity: string | null;
  deliveryState: string | null;
  deliveryLatitude?: number | null;
  deliveryLongitude?: number | null;
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

export function deliveryAddressLabel(order: DeliveryAddress): string {
  return [
    order.deliveryStreet && order.deliveryNumber ? `${order.deliveryStreet}, ${order.deliveryNumber}` : null,
    order.deliveryComplement,
    order.deliveryNeighborhood,
    order.deliveryCity && order.deliveryState ? `${order.deliveryCity}/${order.deliveryState}` : null,
  ]
    .filter(Boolean)
    .join(" - ");
}

export function deliveryDestination(order: DeliveryAddress): string | LatLng {
  const latitude = Number(order.deliveryLatitude);
  const longitude = Number(order.deliveryLongitude);
  return order.deliveryLatitude != null && order.deliveryLongitude != null
    && Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude }
    : deliveryAddressLabel(order);
}

export function googleMapsRouteUrl(destination: string | LatLng, origin?: LatLng): string {
  const params = new URLSearchParams({
    api: "1",
    destination: typeof destination === "string" ? destination : `${destination.latitude},${destination.longitude}`,
    travelmode: "driving",
  });

  if (origin) {
    params.set("origin", `${origin.latitude},${origin.longitude}`);
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function openStreetMapEmbedUrl(position: LatLng): string {
  const margin = 0.01;
  const left = position.longitude - margin;
  const right = position.longitude + margin;
  const bottom = position.latitude - margin;
  const top = position.latitude + margin;
  const params = new URLSearchParams({
    bbox: `${left},${bottom},${right},${top}`,
    layer: "mapnik",
    marker: `${position.latitude},${position.longitude}`,
  });

  return `https://www.openstreetmap.org/export/embed.html?${params.toString()}`;
}
