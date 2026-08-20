import * as Sentry from "@sentry/node";
import { Logger } from "@nestjs/common";

/**
 * Relato de erro para fora da máquina.
 *
 * Até aqui um erro 500 existia apenas no log do container. Quem descobria era o
 * cliente, ligando — e o log já tinha rodado no rodízio quando alguém foi olhar.
 *
 * A precaução central é o que **não** sai daqui. O sistema guarda endereço de
 * cliente, CPF, CNPJ, documento fiscal e credencial de provedor de pagamento;
 * um relatório de erro que leve isso junto troca um problema de operação por um
 * problema de privacidade. Então corpo de requisição, cabeçalho, cookie,
 * parâmetro de consulta e dado de usuário são removidos antes do envio, e o que
 * viaja é o rastro de pilha mais o identificador da requisição, que é o que
 * amarra o relato à linha do log.
 *
 * Sem `SENTRY_DSN` nada é inicializado e todas as funções aqui viram
 * no-operation: em desenvolvimento e em quem não usa o serviço, o comportamento
 * é exatamente o de antes.
 */
const logger = new Logger("ErrorReporting");

let ativo = false;

/** Chaves cujo valor nunca deve sair da máquina, em qualquer profundidade. */
const CAMPOS_SENSIVEIS = /(senha|password|token|secret|authorization|cookie|cpf|cnpj|documento|document|cart(a|ã)o|card|cvv|pix|chave|apikey|api_key|certificad|passphrase)/i;

export function iniciarRelatoDeErros() {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    logger.log("SENTRY_DSN não configurado: relato de erros externo desligado.");
    return false;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV || "development",
    release: process.env.APP_VERSION?.trim() || undefined,
    // `sendDefaultPii` ligado manda IP, cabeçalho e corpo. É exatamente o que
    // não pode sair daqui.
    sendDefaultPii: false,
    // Rastreamento de desempenho abriria um segundo canal de dados sem que
    // ninguém tenha pedido por ele. Ligar é uma decisão separada.
    tracesSampleRate: 0,
    /**
     * Última barreira antes do envio.
     *
     * `beforeSend` roda depois de qualquer integração ter enriquecido o evento,
     * então limpar aqui cobre também o que uma versão futura da biblioteca
     * decidir incluir sozinha.
     */
    beforeSend(evento) {
      if (evento.request) {
        evento.request = {
          method: evento.request.method,
          // A URL fica sem a query: identificador de pedido e e-mail aparecem ali.
          url: evento.request.url?.split("?")[0],
        };
      }
      delete evento.user;
      delete evento.contexts?.device;
      delete evento.server_name;
      if (evento.extra) evento.extra = limparValores(evento.extra) as Record<string, unknown>;
      if (evento.tags) evento.tags = limparValores(evento.tags) as Record<string, string>;
      return evento;
    },
  });
  ativo = true;
  logger.log("Relato de erros externo ativo.");
  return true;
}

/** Troca por "[removido]" o valor de qualquer chave de nome sensível. */
function limparValores(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 6 || valor === null || typeof valor !== "object") return valor;
  if (Array.isArray(valor)) return valor.map((item) => limparValores(item, profundidade + 1));
  const limpo: Record<string, unknown> = {};
  for (const [chave, conteudo] of Object.entries(valor as Record<string, unknown>)) {
    limpo[chave] = CAMPOS_SENSIVEIS.test(chave) ? "[removido]" : limparValores(conteudo, profundidade + 1);
  }
  return limpo;
}

export function relatoDeErrosAtivo() {
  return ativo;
}

/**
 * Registra a falha.
 *
 * `requestId` viaja como etiqueta porque é o que permite achar a linha
 * correspondente no log do container — o relato externo diz que aconteceu, o log
 * diz o contexto que não pode sair da máquina.
 */
export function relatarErro(erro: unknown, contexto: { requestId?: string; rota?: string; origem?: string } = {}) {
  if (!ativo) return;
  Sentry.withScope((escopo) => {
    if (contexto.requestId) escopo.setTag("requestId", contexto.requestId);
    if (contexto.rota) escopo.setTag("rota", contexto.rota);
    if (contexto.origem) escopo.setTag("origem", contexto.origem);
    Sentry.captureException(erro);
  });
}

/** Falha sem exceção: worker que desistiu, conciliação que não fechou. */
export function relatarMensagem(mensagem: string, contexto: { origem?: string } = {}) {
  if (!ativo) return;
  Sentry.withScope((escopo) => {
    if (contexto.origem) escopo.setTag("origem", contexto.origem);
    Sentry.captureMessage(mensagem, "error");
  });
}

/** Espera o envio pendente antes de o processo morrer. */
export async function encerrarRelatoDeErros(timeoutMs = 2000) {
  if (!ativo) return;
  await Sentry.close(timeoutMs);
}
