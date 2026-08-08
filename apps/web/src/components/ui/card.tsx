import { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "min-w-0 rounded-[24px] border border-slate-200/80 bg-white shadow-[0_18px_50px_-36px_rgba(15,23,42,.55)] transition-shadow hover:shadow-[0_24px_60px_-38px_rgba(15,23,42,.5)] dark:border-slate-800 dark:bg-slate-900",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("border-b border-slate-100 px-5 py-4 dark:border-slate-800", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={clsx("text-base font-semibold tracking-normal text-slate-950 dark:text-slate-100", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("px-5 py-4", className)} {...props} />;
}

/**
 * Rodapé único para ações que salvam ou aplicam alterações de um card.
 *
 * Manter o CTA neste ponto evita que cada tela invente uma posição diferente
 * para o botão principal: no desktop ele fica à esquerda e no celular as ações
 * são empilhadas sem esconder informações auxiliares.
 */
interface CardActionsProps extends HTMLAttributes<HTMLDivElement> {
  description?: ReactNode;
}

export function CardActions({ className, description, children, ...props }: CardActionsProps) {
  return (
    <div
      className={clsx(
        "flex flex-col gap-3 border-t border-slate-100 px-5 py-4 dark:border-slate-800",
        className,
      )}
      {...props}
    >
      {description && <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</div>}
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
        {children}
      </div>
    </div>
  );
}
