"use client";

import clsx from "clsx";

export function AssistantMessage({ content, compact = false }: { content: string; compact?: boolean }) {
  return (
    <div
      className={clsx(
        "rounded-lg border border-slate-200 bg-white text-slate-800 shadow-sm",
        compact ? "px-3 py-2" : "px-4 py-3",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">IA</span>
        <span className="text-xs font-medium text-slate-400">Resposta estruturada</span>
      </div>
      <StructuredText content={content} />
    </div>
  );
}

export function UserMessage({ content }: { content: string }) {
  return (
    <div className="ml-auto max-w-[84%] rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm">
      {content}
    </div>
  );
}

function StructuredText({ content }: { content: string }) {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return <p className="text-sm text-slate-500">Sem resposta no momento.</p>;
  }

  return (
    <div className="space-y-2 text-sm leading-6">
      {lines.map((line, index) => {
        const clean = cleanInline(line);
        const bullet = line.match(/^[-*]\s+(.+)/);
        const numbered = line.match(/^\d+[.)]\s+(.+)/);
        const heading = headingText(line);

        if (heading) {
          return (
            <p key={`${line}-${index}`} className="pt-1 text-xs font-bold uppercase tracking-wide text-slate-500">
              {heading}
            </p>
          );
        }

        if (bullet || numbered) {
          return (
            <div key={`${line}-${index}`} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
              <p>{cleanInline(bullet?.[1] ?? numbered?.[1] ?? clean)}</p>
            </div>
          );
        }

        return <p key={`${line}-${index}`}>{clean}</p>;
      })}
    </div>
  );
}

function headingText(line: string) {
  if (line.startsWith("#")) return cleanInline(line.replace(/^#+\s*/, ""));
  if (/^\*\*.+\*\*:?$/.test(line)) return cleanInline(line.replace(/:$/, ""));
  if (line.endsWith(":") && line.length <= 48) return cleanInline(line.replace(/:$/, ""));
  return null;
}

function cleanInline(line: string) {
  return line.replace(/\*\*/g, "").replace(/__/g, "");
}
