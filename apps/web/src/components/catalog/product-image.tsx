import clsx from "clsx";
import { assetUrl } from "@/lib/api-client";

export function ProductImage({
  src,
  alt,
  className,
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  const resolvedSrc = assetUrl(src);

  if (resolvedSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={resolvedSrc} alt={alt} className={clsx("rounded-lg object-cover", className)} />
    );
  }

  return (
    <div
      className={clsx(
        "grid place-items-center rounded-lg border border-brand-100 bg-gradient-to-br from-brand-50 to-accent-50 text-lg font-black text-brand-700 dark:border-brand-900/50 dark:from-brand-950/40 dark:to-accent-950/30 dark:text-brand-300",
        className,
      )}
      aria-label={alt}
    >
      {alt.trim().charAt(0).toUpperCase() || "C"}
    </div>
  );
}
