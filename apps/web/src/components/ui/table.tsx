import { ReactNode } from "react";

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export function Table<T>({ columns, rows, rowKey, emptyMessage = "Nenhum registro encontrado." }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">{emptyMessage}</p>;
  }

  return (
    <>
      <div className="grid gap-3 sm:hidden">
        {rows.map((row) => (
          <article key={rowKey(row)} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {columns.map((col, index) => (
              <div key={col.header} className={index === 0 ? "border-b border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60" : "grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-b border-slate-100 px-4 py-3 last:border-0 dark:border-slate-800"}>
                {index > 0 && <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{col.header}</p>}
                <div className={index === 0 ? "font-black text-slate-950 dark:text-slate-100" : "min-w-0 text-sm text-slate-700 dark:text-slate-300"}>{col.render(row)}</div>
              </div>
            ))}
          </article>
        ))}
      </div>
      <div className="hidden max-w-full overflow-x-auto sm:block">
      <table className="min-w-[640px] w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            {columns.map((col) => (
              <th key={col.header} className={col.className ?? "px-5 py-3 font-medium"}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-slate-100/80 transition-colors last:border-0 hover:bg-brand-50/40 dark:border-slate-800/60 dark:hover:bg-slate-800/50"
            >
              {columns.map((col) => (
                <td key={col.header} className={col.className ?? "px-5 py-3 text-slate-700 dark:text-slate-200"}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
