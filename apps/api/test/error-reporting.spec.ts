import { relatarErro, relatoDeErrosAtivo } from "../src/common/observability/error-reporting";

/**
 * O relato de erro não pode virar vazamento de dado.
 *
 * O sistema guarda endereço de cliente, CPF, CNPJ, documento fiscal e credencial
 * de provedor de pagamento. Um relatório que leve isso junto troca um problema de
 * operação por um problema de privacidade — e por um problema de LGPD.
 */
describe("relato de erros", () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => { process.env = { ...ORIGINAL }; });

  it("sem DSN configurado nada é iniciado", () => {
    // É o estado de desenvolvimento e de quem não usa o serviço: o
    // comportamento tem de ser exatamente o de antes.
    expect(relatoDeErrosAtivo()).toBe(false);
  });

  it("relatar sem estar ativo não quebra nem lança", () => {
    expect(() => relatarErro(new Error("falha qualquer"), { requestId: "abc" })).not.toThrow();
  });
});

/**
 * O limpador roda como última barreira, depois de qualquer integração ter
 * enriquecido o evento. Testado pelo comportamento visível: o que sai do
 * `beforeSend` configurado.
 */
describe("limpeza do evento antes do envio", () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.resetModules();
  });

  function opcoesConfiguradas() {
    jest.resetModules();
    process.env.SENTRY_DSN = "https://exemplo@o0.ingest.sentry.io/0";
    let capturado: any = null;
    jest.doMock("@sentry/node", () => ({
      init: (opcoes: any) => { capturado = opcoes; },
      withScope: () => undefined,
      captureException: () => undefined,
      captureMessage: () => undefined,
      close: async () => true,
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const modulo = require("../src/common/observability/error-reporting");
    modulo.iniciarRelatoDeErros();
    return capturado as { beforeSend: (evento: any) => any; sendDefaultPii: boolean; tracesSampleRate: number };
  }

  const beforeSendConfigurado = () => opcoesConfiguradas().beforeSend;

  it("tira corpo, cabeçalho e cookie da requisição", () => {
    const beforeSend = beforeSendConfigurado();

    const evento = beforeSend({
      request: {
        method: "POST",
        url: "https://chegowia.com.br/api/orders?email=cliente@exemplo.com",
        data: { cpf: "12345678900", endereco: "Rua tal, 123" },
        headers: { authorization: "Bearer segredo" },
        cookies: "session=abc",
      },
    });

    expect(evento.request).toEqual({ method: "POST", url: "https://chegowia.com.br/api/orders" });
  });

  it("tira o usuário e o nome da máquina", () => {
    const beforeSend = beforeSendConfigurado();

    const evento = beforeSend({
      user: { id: "u-1", email: "cliente@exemplo.com", ip_address: "10.0.0.1" },
      server_name: "api-producao-1",
    });

    expect(evento.user).toBeUndefined();
    expect(evento.server_name).toBeUndefined();
  });

  it("substitui valor de campo sensível em qualquer profundidade", () => {
    const beforeSend = beforeSendConfigurado();

    const evento = beforeSend({
      extra: {
        pedido: {
          cliente: { cpf: "12345678900", nome: "Maria" },
          pagamento: { cartao: "4111111111111111", valor: 90 },
        },
        certificadoSenha: "abc",
      },
    });

    expect(evento.extra.pedido.cliente.cpf).toBe("[removido]");
    expect(evento.extra.pedido.pagamento.cartao).toBe("[removido]");
    expect(evento.extra.certificadoSenha).toBe("[removido]");
    // O que não é sensível continua, senão o relato não serve para investigar.
    expect(evento.extra.pedido.cliente.nome).toBe("Maria");
    expect(evento.extra.pedido.pagamento.valor).toBe(90);
  });

  it("nasce sem PII e sem rastreamento de desempenho", () => {
    const opcoes = opcoesConfiguradas();
    // `sendDefaultPii` ligado mandaria IP, cabeçalho e corpo — exatamente o que
    // não pode sair. Rastreamento abriria um segundo canal de dados que ninguém
    // pediu; ligar é decisão separada.
    expect(opcoes.sendDefaultPii).toBe(false);
    expect(opcoes.tracesSampleRate).toBe(0);
  });
});
