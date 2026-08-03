"use client";

import { ChangeEvent, InputHTMLAttributes, useId, useRef } from "react";
import clsx from "clsx";
import { BRAZIL_STATES, formatCep, formatCurrencyInput, formatDocument, formatPhone } from "@/lib/brazilian-format";
import { FIELD_CLASSES, Input, Select } from "./input";

type Mask = "phone" | "document" | "cep";

export function MaskedInput({ mask, onChange, ...props }: InputHTMLAttributes<HTMLInputElement> & { mask: Mask }) {
  const formatter = mask === "phone" ? formatPhone : mask === "document" ? formatDocument : formatCep;
  return <Input {...props} inputMode={mask === "phone" ? "tel" : "numeric"} onChange={(event) => {
    const next = formatter(event.target.value);
    event.target.value = next;
    onChange?.(event);
  }} />;
}

/**
 * Campo de dinheiro em reais.
 *
 * O prefixo `R$` fica fora do input, como adorno: dentro do valor ele viraria
 * texto que o usuário consegue apagar, e cada apagão desses é um valor
 * digitado errado no fechamento do caixa.
 */
export function CurrencyInput({
  value,
  onValueChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400 dark:text-slate-500">
        R$
      </span>
      <Input
        {...props}
        className={clsx("pl-11 text-right font-semibold tabular-nums", props.className)}
        inputMode="numeric"
        value={value}
        placeholder={props.placeholder ?? "0,00"}
        onChange={(event) => onValueChange(formatCurrencyInput(event.target.value))}
      />
    </div>
  );
}

export function BrazilStateSelect({ placeholder = "Selecione", ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { placeholder?: string }) {
  return <Select {...props}><option value="">{placeholder}</option>{BRAZIL_STATES.map(([uf, name]) => <option key={uf} value={uf}>{uf} — {name}</option>)}</Select>;
}

export function FileUpload({ accept, file, onFile, hint = "PDF, DOC ou DOCX · máximo de 6 MB" }: { accept?: string; file: File | null; onFile: (file: File | null) => void; hint?: string }) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const handle = (event: ChangeEvent<HTMLInputElement>) => onFile(event.target.files?.[0] ?? null);
  return <div><input ref={ref} id={id} className="sr-only" type="file" accept={accept} onChange={handle} /><label htmlFor={id} className={clsx(FIELD_CLASSES, "flex min-h-[82px] cursor-pointer items-center gap-3 border-dashed bg-slate-50 hover:border-brand-300 hover:bg-brand-50/40 dark:bg-slate-800/60")}><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-xl shadow-sm dark:bg-slate-900">↑</span><span className="min-w-0"><strong className="block truncate text-sm text-slate-800 dark:text-slate-200">{file?.name ?? "Escolher arquivo"}</strong><span className="mt-0.5 block text-xs font-normal text-slate-400">{file ? `${Math.ceil(file.size / 1024)} KB · clique para substituir` : hint}</span></span></label>{file && <button type="button" className="mt-2 text-xs font-bold text-rose-600 hover:underline dark:text-rose-400" onClick={() => { onFile(null); if (ref.current) ref.current.value = ""; }}>Remover arquivo</button>}</div>;
}
