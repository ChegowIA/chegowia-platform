import clsx from "clsx";
import type { ReactNode } from "react";

const ICONS: Record<string, ReactNode> = {
  all: (
    <>
      <path d="M4 6h6v6H4z" />
      <path d="M14 6h6v6h-6z" />
      <path d="M4 16h6v2H4z" />
      <path d="M14 16h6v2h-6z" />
    </>
  ),
  burger: (
    <>
      <path d="M4 11c.5-3.4 3.3-6 8-6s7.5 2.6 8 6H4z" />
      <path d="M5 14h14" />
      <path d="M6 18h12c1.2 0 2-.8 2-2H4c0 1.2.8 2 2 2z" />
      <path d="M9 8h.01M12 7h.01M15 8h.01" />
    </>
  ),
  pizza: (
    <>
      <path d="M6 4c5.6 0 9.8 2.2 12 6L9 21 6 4z" />
      <path d="M8 8c3.4.4 6 1.6 8 3.6" />
      <path d="M10.5 11.5h.01M12.5 15h.01M15 12.5h.01" />
    </>
  ),
  meal: (
    <>
      <path d="M4 11h16v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7z" />
      <path d="M7 11V8a5 5 0 0 1 10 0v3" />
      <path d="M9 15h6" />
    </>
  ),
  sushi: (
    <>
      <rect x="4" y="7" width="16" height="10" rx="5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M7 9.5c1.2 1 1.2 4 0 5" />
      <path d="M17 9.5c-1.2 1-1.2 4 0 5" />
    </>
  ),
  "ice-cream": (
    <>
      <path d="M8 10a4 4 0 1 1 8 0" />
      <path d="M7 10h10l-4 11h-2L7 10z" />
      <path d="M10 7.5h.01M14 7.5h.01" />
    </>
  ),
  leaf: (
    <>
      <path d="M20 4c-7.5.2-12.5 3.8-14 10.5C5.2 18 7.6 20.6 11 20c5.8-1 8.5-7.2 9-16z" />
      <path d="M6 19c2.2-4.6 5.7-8 10.5-10" />
    </>
  ),
  cake: (
    <>
      <path d="M5 10h14v9H5z" />
      <path d="M5 14c2 1 3.5 1 5 0s3-1 5 0 2.5 1 4 0" />
      <path d="M8 10V7M12 10V6M16 10V7" />
      <path d="M8 6h.01M12 5h.01M16 6h.01" />
    </>
  ),
  drink: (
    <>
      <path d="M7 4h10l-1.2 16H8.2L7 4z" />
      <path d="M8 8h8" />
      <path d="M12 4l3-2" />
      <path d="M10 13h4" />
    </>
  ),
  pasta: (
    <>
      <path d="M5 13c1.5 5 12.5 5 14 0" />
      <path d="M7 13h10" />
      <path d="M9 13c0-2 1-3 3-3s3 1 3 3" />
      <path d="M8 7c1.2 1 2.4 1 3.6 0s2.4-1 3.6 0" />
    </>
  ),
  grill: (
    <>
      <path d="M5 10h14" />
      <path d="M7 10c0 4 2 6 5 6s5-2 5-6" />
      <path d="M9 20l2-4M15 16l2 4" />
      <path d="M9 5c-.8.8-.8 1.6 0 2.4M13 4c-.8.8-.8 1.8 0 2.8M17 5c-.8.8-.8 1.6 0 2.4" />
    </>
  ),
  bakery: (
    <>
      <path d="M4 13c1-4 4-7 8-7s7 3 8 7c-2.3 4.5-13.7 4.5-16 0z" />
      <path d="M8 10c.8 1.2.8 2.5 0 3.8M12 9c.8 1.5.8 3 0 4.5M16 10c.8 1.2.8 2.5 0 3.8" />
    </>
  ),
  market: (
    <>
      <path d="M5 9h14l-1 11H6L5 9z" />
      <path d="M8 9a4 4 0 0 1 8 0" />
      <path d="M9 13h6" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      <path d="M5 17l.8 2.2L8 20l-2.2.8L5 23l-.8-2.2L2 20l2.2-.8L5 17z" />
    </>
  ),
};

export function ProductTypeIcon({ icon, className }: { icon?: string | null; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={clsx("h-6 w-6", className)}
      aria-hidden="true"
    >
      {ICONS[icon || "spark"] ?? ICONS.spark}
    </svg>
  );
}
