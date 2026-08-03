import clsx from "clsx";

/**
 * A arte é um PNG de tinta escura, então precisa ser invertida para branco
 * sempre que estiver sobre fundo escuro. A regra no projeto é:
 *
 * - superfície escura nos DOIS temas (sidebars, heros, painel de login) → `light`
 * - superfície que troca de cor junto com o tema (headers claros) → `adaptive`
 * - superfície clara nos dois temas (card branco das telas de status) → sem prop
 *
 * Nunca envolva a logo num "chip" branco para forçar contraste — use `light`.
 */
export function BrandLogo({
  variant = "full",
  className,
  light = false,
  adaptive = false,
}: {
  variant?: "mark" | "full";
  className?: string;
  /** Inverte para branco sempre — use sobre superfícies escuras nos dois temas. */
  light?: boolean;
  /**
   * Inverte para branco apenas no tema escuro. Use quando a superfície abaixo do
   * logo troca de clara para escura junto com o tema; sem isso, a arte (PNG de
   * tinta escura) fica invisível no modo escuro.
   */
  adaptive?: boolean;
}) {
  return (
    <span className={clsx("inline-flex items-center", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={variant === "mark" ? "/brand/chegowia-mark.png" : "/brand/chegowia-logo.png"}
        alt={variant === "mark" ? "ChegowIA" : "ChegowIA"}
        className={clsx(
          "block h-full w-full object-contain",
          light && variant === "full" && "brightness-0 invert",
          !light && adaptive && variant === "full" && "dark:brightness-0 dark:invert",
        )}
      />
    </span>
  );
}
