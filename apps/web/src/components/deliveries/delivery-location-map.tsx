import { formatDateTime } from "@/lib/format";
import { LatLng, openStreetMapEmbedUrl } from "@/lib/delivery-maps";

export function DeliveryLocationMap({
  position,
  updatedAt,
}: {
  position?: LatLng | null;
  updatedAt?: string | null;
}) {
  if (!position) {
    return (
      <div className="grid min-h-48 place-items-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-sm text-slate-500 dark:bg-slate-800/60 dark:border-slate-800 dark:text-slate-400">
        Aguardando o motoboy compartilhar a localização.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800">
      <iframe
        title="Localização do motoboy"
        src={openStreetMapEmbedUrl(position)}
        className="h-56 w-full border-0"
        loading="lazy"
      />
      <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Última atualização: {updatedAt ? formatDateTime(updatedAt) : "agora"}
      </div>
    </div>
  );
}
