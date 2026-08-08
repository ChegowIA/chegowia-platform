"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";

export function TableQrCode({ url, tableName, companyName }: { url: string; tableName: string; companyName?: string }) {
  const [image, setImage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 720,
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((value) => active && setImage(value))
      .catch(() => active && setImage(null));
    return () => {
      active = false;
    };
  }, [url]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const filename = `qr-${tableName.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "mesa"}.png`;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[26px] border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-amber-50 p-5 text-center dark:border-brand-900/50 dark:from-brand-950/30 dark:via-slate-900 dark:to-amber-950/20">
        <p className="text-[10px] font-black uppercase tracking-[.18em] text-brand-700 dark:text-brand-300">Pedido na mesa</p>
        <h3 className="mt-1 text-2xl font-black text-slate-950 dark:text-slate-100">{tableName}</h3>
        {companyName && <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">{companyName}</p>}
        <div className="mx-auto mt-5 grid h-56 w-56 place-items-center rounded-[22px] bg-white p-3 shadow-xl shadow-slate-950/10 dark:bg-white">
          {image ? (
            // QR é uma imagem gerada localmente pelo navegador; `img` evita
            // que o otimizador do Next altere a matriz e prejudique a leitura.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={`QR Code da ${tableName}`} className="h-full w-full" />
          ) : <span className="text-sm font-bold text-slate-500">Gerando QR…</span>}
        </div>
        <p className="mx-auto mt-4 max-w-sm text-xs leading-5 text-slate-600 dark:text-slate-300">Ao escanear, a pessoa abre somente o cardápio desta mesa e os pedidos entram na comanda atual.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
        <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{url}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="outline" className="w-full" onClick={copyLink}>{copied ? "Link copiado" : "Copiar link"}</Button>
        {image ? (
          <a
            href={image}
            download={filename}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(234,88,12,.8)] transition hover:-translate-y-0.5 hover:bg-brand-700"
          >
            Baixar QR
          </a>
        ) : <Button type="button" className="w-full" disabled>Preparando…</Button>}
      </div>
    </div>
  );
}
