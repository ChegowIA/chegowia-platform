import { ButtonHTMLAttributes, forwardRef } from "react";
import clsx from "clsx";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700 hover:shadow-lift disabled:bg-brand-300",
  secondary:
    "bg-accent-700 text-white shadow-sm hover:bg-accent-800 disabled:bg-accent-300 dark:bg-accent-300 dark:text-accent-950",
  outline:
    "border border-slate-300 bg-white text-slate-700 shadow-sm hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
  ghost: "text-slate-700 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-slate-800",
  danger: "bg-red-600 text-white shadow-sm hover:bg-red-700 disabled:bg-red-300",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "min-h-8 rounded-md px-3 py-1.5 text-sm",
  md: "min-h-10 rounded-lg px-4 py-2 text-sm",
  lg: "min-h-11 rounded-lg px-5 py-2.5 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", isLoading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={clsx(
          "inline-flex items-center justify-center gap-2 font-medium transition-colors disabled:cursor-not-allowed",
          "focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:ring-offset-2",
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className,
        )}
        {...props}
      >
        {isLoading ? "..." : children}
      </button>
    );
  },
);
Button.displayName = "Button";
