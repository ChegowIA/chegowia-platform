"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

export interface DeliveryPin {
  latitude: number;
  longitude: number;
}

export interface DeliveryLocationLookup {
  addressLine: string;
  streetName?: string;
  neighborhood?: string;
  city: string;
  state: string;
  zipCode: string;
}

export function DeliveryPinPicker({ lookup, point, confirmed, confirming = false, context = "delivery", onPointChange, onConfirm }: {
  lookup: DeliveryLocationLookup;
  point: DeliveryPin | null;
  confirmed: boolean;
  confirming?: boolean;
  context?: "delivery" | "store";
  onPointChange: (point: DeliveryPin) => void;
  onConfirm: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const pointChangeRef = useRef(onPointChange);
  const pointRef = useRef(point);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);

  useEffect(() => { pointChangeRef.current = onPointChange; }, [onPointChange]);
  useEffect(() => { pointRef.current = point; }, [point]);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let map: LeafletMap | null = null;
    void import("leaflet").then((L) => {
      if (disposed || !containerRef.current) return;
      const initialPoint = pointRef.current;
      map = L.map(containerRef.current, { scrollWheelZoom: false }).setView(
        initialPoint ? [initialPoint.latitude, initialPoint.longitude] : [-16.7, -49.25],
        initialPoint ? 17 : 5,
      );
      mapRef.current = map;
      L.tileLayer(
        process.env.NEXT_PUBLIC_MAP_TILES_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
      ).addTo(map);
      const icon = L.divIcon({
        className: "",
        html: '<div style="width:26px;height:26px;border:4px solid white;border-radius:50%;background:#ea580c;box-shadow:0 2px 10px #0008"></div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      const marker = L.marker(initialPoint ? [initialPoint.latitude, initialPoint.longitude] : [-16.7, -49.25], {
        draggable: true,
        icon,
      }).addTo(map);
      markerRef.current = marker;
      if (!initialPoint) marker.setOpacity(0);
      marker.on("dragend", () => {
        const location = marker.getLatLng();
        pointChangeRef.current({ latitude: location.lat, longitude: location.lng });
      });
      map.on("click", (event) => {
        marker.setOpacity(1);
        marker.setLatLng(event.latlng);
        pointChangeRef.current({ latitude: event.latlng.lat, longitude: event.latlng.lng });
      });
      setTimeout(() => { if (!disposed) map?.invalidateSize(); }, 200);
    }).catch(() => setError("Não foi possível abrir o mapa. Atualize a página e tente novamente."));

    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // O mapa nasce uma vez; pontos subsequentes são movidos pelo efeito abaixo.
  }, []);

  useEffect(() => {
    if (!point) {
      markerRef.current?.setOpacity(0);
      return;
    }
    markerRef.current?.setOpacity(1);
    markerRef.current?.setLatLng([point.latitude, point.longitude]);
    mapRef.current?.setView([point.latitude, point.longitude], Math.max(mapRef.current.getZoom(), 16));
  }, [point]);

  async function findAddress() {
    if (!lookup.addressLine.trim() || !lookup.city.trim() || !lookup.state.trim() || lookup.zipCode.replace(/\D/g, "").length !== 8) {
      setError("Preencha endereço, cidade, estado e CEP antes de procurar no mapa.");
      return;
    }
    setError(null);
    setGpsAccuracy(null);
    setLoading(true);
    try {
      const { data } = await api.post<DeliveryPin>("/addresses/location-preview", lookup, { notify: false });
      // A prévia também traz metadados (source/approximate). O estado do
      // marcador e os PATCH/POST de confirmação aceitam apenas coordenadas.
      onPointChange({ latitude: data.latitude, longitude: data.longitude });
    } catch (requestError) {
      setError(apiErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  function useCurrentPosition() {
    if (!navigator.geolocation) {
      setError("Este dispositivo não disponibiliza localização. Toque no mapa para escolher o ponto.");
      return;
    }
    setError(null);
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLoading(false);
        setGpsAccuracy(Math.round(position.coords.accuracy));
        onPointChange({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      () => {
        setLoading(false);
        setError("Não foi possível obter sua localização. Toque no mapa ou procure pelo endereço.");
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <div>
        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{context === "store" ? "Ponto de saída da loja no mapa" : "Ponto exato da entrega no mapa"}</p>
        <p className="mt-1 text-xs leading-5 text-slate-700 dark:text-slate-300">
          Busque a região, arraste o marcador até a entrada pela rua e confirme. O CEP sozinho não define a posição do imóvel.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" isLoading={loading} onClick={() => void findAddress()}>Buscar endereço</Button>
        <Button type="button" size="sm" variant="outline" disabled={loading} onClick={useCurrentPosition}>Usar minha localização</Button>
      </div>
      <div ref={containerRef} role="application" aria-label="Mapa para escolher o ponto de entrega" className="h-72 w-full overflow-hidden rounded-lg border border-slate-300 bg-slate-200 dark:border-slate-700 dark:bg-slate-800" />
      {gpsAccuracy !== null && <p className="text-xs text-amber-800 dark:text-amber-300">Precisão informada pelo aparelho: cerca de {gpsAccuracy} m. Confira o marcador antes de confirmar.</p>}
      {point && <p className="text-xs text-slate-600 dark:text-slate-300">Ponto selecionado: {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</p>}
      {error && <p className="text-xs text-red-700 dark:text-red-300">{error}</p>}
      <Button type="button" size="sm" isLoading={confirming} disabled={!point || confirmed} onClick={onConfirm}>
        {confirmed ? (context === "store" ? "Ponto salvo" : "Ponto confirmado") : (context === "store" ? "Confirmar e salvar este ponto" : "Confirmar este ponto")}
      </Button>
      {confirmed && <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">{context === "store" ? "Ponto salvo na loja. A rota e a taxa de entrega começam aqui." : "O motoboy receberá este ponto para navegar até você."}</p>}
    </div>
  );
}
