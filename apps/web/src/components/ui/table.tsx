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
    <div className="max-w-full overflow-x-auto">
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
  );
}
