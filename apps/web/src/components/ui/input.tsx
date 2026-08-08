import { InputHTMLAttributes, LabelHTMLAttributes, TextareaHTMLAttributes, forwardRef } from "react";
import clsx from "clsx";

export const FIELD_CLASSES =
  "min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,.03)] outline-none placeholder:font-normal placeholder:text-slate-400 transition duration-200 hover:border-slate-300 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:border-slate-600 dark:disabled:bg-slate-800 dark:disabled:text-slate-400";

const EMAIL_PATTERN = String.raw`[^\s@]+@[^\s@]+\.[^\s@]{2,}`;

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, onInput, onInvalid, pattern, title, type, ...props }, ref) => (
    <input
      ref={ref}
      className={clsx(FIELD_CLASSES, className)}
      type={type}
      pattern={type === "email" ? pattern ?? EMAIL_PATTERN : pattern}
      title={type === "email" ? title ?? "Informe um e-mail válido, como nome@dominio.com." : title}
      onInvalid={(event) => {
        if (type === "email") {
          event.currentTarget.setCustomValidity("Informe um e-mail válido.");
        }
        onInvalid?.(event);
      }}
      onInput={(event) => {
        if (type === "email") {
          event.currentTarget.setCustomValidity("");
        }
        onInput?.(event as Parameters<NonNullable<typeof onInput>>[0]);
      }}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={clsx(FIELD_CLASSES, "min-h-[112px] resize-y leading-6", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={clsx(FIELD_CLASSES, "cursor-pointer appearance-none bg-[linear-gradient(45deg,transparent_50%,#64748b_50%),linear-gradient(135deg,#64748b_50%,transparent_50%)] bg-[position:calc(100%-18px)_50%,calc(100%-13px)_50%] bg-[size:5px_5px,5px_5px] bg-no-repeat pr-10 dark:bg-[linear-gradient(45deg,transparent_50%,#94a3b8_50%),linear-gradient(135deg,#94a3b8_50%,transparent_50%)]", className)} {...props}>
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={clsx("block text-[13px] font-bold leading-5 text-slate-700 dark:text-slate-300", className)} {...props} />;
}

export function FormField({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error && <p className="flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400"><span>!</span>{error}</p>}
    </div>
  );
}
