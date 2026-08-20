/**
 * Manda para a API o erro que quebrou a tela.
 *
 * Vai pela nossa API, e não direto para um serviço externo, por três razões: a
 * chave do serviço não desce para o navegador, a política de conteúdo da página
 * não precisa liberar host novo, e a limpeza de dado sensível continua num único
 * lugar — o mesmo por onde passam os erros do servidor.
 *
 * Falha em silêncio de propósito. Se o relato do erro também falhar, insistir só
 * empilha erro sobre erro na frente de quem já está vendo uma tela quebrada.
 */
export function reportClientError(error: unknown, extra?: { digest?: string }) {
  try {
    const base = process.env.NEXT_PUBLIC_API_URL;
    if (!base) return;
    const mensagem = error instanceof Error ? error.message : String(error);
    const corpo = JSON.stringify({
      message: mensagem.slice(0, 500),
      stack: error instanceof Error && error.stack ? error.stack.slice(0, 4000) : undefined,
      path: typeof window === "undefined" ? undefined : window.location.pathname.slice(0, 300),
      digest: extra?.digest?.slice(0, 120),
    });
    // `keepalive` porque a tela de erro costuma ser seguida de recarregamento, e
    // sem isso a requisição morreria antes de sair.
    void fetch(`${base.replace(/\/$/, "")}/observability/client-error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: corpo,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Nada aqui pode atrapalhar a tela de erro.
  }
}
