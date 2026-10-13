"use client";

import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function AssistantMessage({ content, compact = false }: { content: string; compact?: boolean }) {
  return (
    <div
      className={clsx(
        "min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:border-slate-800 dark:text-slate-200",
        compact ? "px-3 py-2" : "px-4 py-3",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-950/30 dark:text-brand-300">IA</span>
        <span className="text-xs font-medium text-slate-400">Assistente ChegowIA</span>
      </div>
      {content.trim() ? <MarkdownContent content={content} /> : <p className="text-sm text-slate-500 dark:text-slate-400">Sem resposta no momento.</p>}
    </div>
  );
}

export function UserMessage({ content }: { content: string }) {
  return (
    <div className="ml-auto max-w-[84%] whitespace-pre-wrap break-words rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm [overflow-wrap:anywhere]">
      {content}
    </div>
  );
}

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="min-w-0 max-w-full text-sm leading-6 [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h3 className="mb-2 mt-3 text-base font-bold text-slate-950 first:mt-0 dark:text-slate-100">{children}</h3>,
          h2: ({ children }) => <h3 className="mb-2 mt-3 text-sm font-bold text-slate-950 first:mt-0 dark:text-slate-100">{children}</h3>,
          h3: ({ children }) => <h4 className="mb-1.5 mt-3 text-sm font-bold text-slate-900 first:mt-0 dark:text-slate-100">{children}</h4>,
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-brand-500">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:font-semibold marker:text-brand-600">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          strong: ({ children }) => <strong className="font-bold text-slate-950 dark:text-slate-100">{children}</strong>,
          blockquote: ({ children }) => (
            <blockquote className="my-3 rounded-r-lg border-l-4 border-brand-400 bg-brand-50 px-3 py-1 text-slate-700 dark:bg-brand-950/30 dark:text-slate-300">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              className="font-semibold text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800 dark:text-brand-300"
              href={href}
              target="_blank"
              rel="noreferrer noopener"
            >
              {children}
            </a>
          ),
          code: ({ className, children }) =>
            className ? (
              <code className={className}>{children}</code>
            ) : (
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.82em] text-slate-900 dark:bg-slate-800 dark:text-slate-100">{children}</code>
            ),
          pre: ({ children }) => (
            <pre className="my-3 max-w-full overflow-x-auto rounded-xl bg-slate-950 p-3 text-xs leading-5 text-slate-100">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-3 max-w-full overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-[360px] border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{children}</thead>,
          th: ({ children }) => <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2 font-bold dark:border-slate-800">{children}</th>,
          td: ({ children }) => <td className="border-b border-slate-100 px-3 py-2 align-top last:border-b-0 dark:border-slate-800">{children}</td>,
          hr: () => <hr className="my-3 border-slate-200 dark:border-slate-800" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
