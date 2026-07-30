interface DeliveryAddress {
  deliveryStreet: string;
  deliveryNumber: string;
  deliveryComplement?: string | null;
  deliveryNeighborhood: string;
  deliveryCity: string;
  deliveryState: string;
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

export function deliveryAddressLabel(order: DeliveryAddress): string {
  return [
    `${order.deliveryStreet}, ${order.deliveryNumber}`,
    order.deliveryComplement,
    order.deliveryNeighborhood,
    `${order.deliveryCity}/${order.deliveryState}`,
  ]
    .filter(Boolean)
    .join(" - ");
}

export function googleMapsRouteUrl(destination: string, origin?: LatLng): string {
  const params = new URLSearchParams({
    api: "1",
    destination,
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
