export type ToastKind = "success" | "error" | "info" | "warning";

export type ToastOptions = {
  title?: string;
  duration?: number;
};

export type ToastItem = Required<Pick<ToastOptions, "duration">> & {
  id: string;
  kind: ToastKind;
  message: string;
  title: string;
};

type Listener = (items: ToastItem[]) => void;

const listeners = new Set<Listener>();
let items: ToastItem[] = [];
let sequence = 0;
let lastMessage = "";
let lastPublishedAt = 0;

const DEFAULT_TITLES: Record<ToastKind, string> = {
  success: "Pronto",
  error: "Não foi possível concluir",
  info: "Informação",
  warning: "Atenção",
};

function emit() {
  const snapshot = [...items];
  listeners.forEach((listener) => listener(snapshot));
}

function dismiss(id: string) {
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return;
  items = next;
  emit();
}

function publish(kind: ToastKind, message: string, options: ToastOptions = {}) {
  const normalizedMessage = message.trim();
  if (!normalizedMessage) return "";

  // Uma falha de rede pode ser propagada pela query, pela mutation e por uma
  // tela de fallback. Evitamos transformar a mesma mensagem em uma pilha de
  // avisos idênticos para a pessoa.
  const now = Date.now();
  if (normalizedMessage === lastMessage && now - lastPublishedAt < 900) return "";
  lastMessage = normalizedMessage;
  lastPublishedAt = now;

  const id = `toast-${now}-${++sequence}`;
  const duration = Math.max(2_500, options.duration ?? (kind === "error" ? 6_500 : 4_500));
  items = [
    ...items.slice(-3),
    { id, kind, message: normalizedMessage, title: options.title ?? DEFAULT_TITLES[kind], duration },
  ];
  emit();

  if (typeof window !== "undefined") window.setTimeout(() => dismiss(id), duration);
  return id;
}

/** Notificações transitórias globais, sem acoplar a tela a uma biblioteca externa. */
export const toast = {
  success: (message: string, options?: ToastOptions) => publish("success", message, options),
  error: (message: string, options?: ToastOptions) => publish("error", message, options),
  info: (message: string, options?: ToastOptions) => publish("info", message, options),
  warning: (message: string, options?: ToastOptions) => publish("warning", message, options),
  dismiss,
};

export function subscribeToToasts(listener: Listener) {
  listeners.add(listener);
  listener([...items]);
  return () => {
    listeners.delete(listener);
  };
}
