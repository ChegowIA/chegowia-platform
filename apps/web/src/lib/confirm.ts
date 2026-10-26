export type ConfirmTone = "danger" | "warning" | "default";
export type ConfirmIcon = "trash" | "stop" | "check" | "alert";

export type ConfirmOptions = {
  title: string;
  message: string;
  /** Destaque curto do que será afetado, como o nome da campanha. */
  subject?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  icon?: ConfirmIcon;
};

export type ConfirmRequest = Required<Omit<ConfirmOptions, "subject">> & {
  id: number;
  subject: string | null;
};

type Listener = (request: ConfirmRequest | null) => void;

const listeners = new Set<Listener>();
let current: ConfirmRequest | null = null;
let resolveCurrent: ((value: boolean) => void) | null = null;
let sequence = 0;

function emit() {
  listeners.forEach((listener) => listener(current));
}

/** Fecha o balão aberto com a resposta dada. */
export function answerConfirm(value: boolean) {
  const resolve = resolveCurrent;
  current = null;
  resolveCurrent = null;
  emit();
  resolve?.(value);
}

/**
 * Confirmação no lugar do `window.confirm`.
 *
 * A caixa nativa não segue o tema, mostra o domínio no título e não diz qual
 * botão é o perigoso. Esta devolve a mesma promessa de sim ou não, então a
 * troca na tela é de uma linha. Um pedido novo recusa o anterior, que ficaria
 * sem resposta se fosse simplesmente substituído.
 */
export function confirmar(options: ConfirmOptions): Promise<boolean> {
  if (resolveCurrent) answerConfirm(false);
  const tone = options.tone ?? "default";
  current = {
    id: ++sequence,
    title: options.title,
    message: options.message,
    subject: options.subject?.trim() || null,
    confirmLabel: options.confirmLabel ?? "Confirmar",
    cancelLabel: options.cancelLabel ?? "Voltar",
    tone,
    icon: options.icon ?? (tone === "danger" ? "trash" : tone === "warning" ? "alert" : "check"),
  };
  emit();
  return new Promise((resolve) => { resolveCurrent = resolve; });
}

export function subscribeToConfirm(listener: Listener) {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
