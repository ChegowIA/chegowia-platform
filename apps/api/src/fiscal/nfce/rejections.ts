/**
 * Tradução das rejeições da SEFAZ para instrução acionável.
 *
 * São centenas de códigos e a mensagem oficial é escrita para quem desenvolve
 * emissor, não para quem está atrás do balcão: "Rejeicao: Duplicidade de NF-e,
 * com diferenca na Chave de Acesso" não diz ao lojista o que fazer. Sem esta
 * camada, o suporte vira o tradutor — a cada venda.
 *
 * O mapa cobre o que de fato acontece em restaurante. O que não estiver aqui
 * cai num texto genérico que ao menos diz para quem ligar.
 */

export interface RejectionGuidance {
  /** O que o lojista deve fazer, em uma frase. */
  hint: string;
  /** Se vale a pena reenviar automaticamente o mesmo documento. */
  retryable: boolean;
  /** Se a numeração foi queimada e precisa de inutilização. */
  burnsNumber: boolean;
}

const GUIDANCE: Record<string, RejectionGuidance> = {
  // ---- Sucesso e status de fluxo ----
  "100": { hint: "Nota autorizada.", retryable: false, burnsNumber: false },
  "101": { hint: "Cancelamento registrado.", retryable: false, burnsNumber: false },
  "102": { hint: "Numeração inutilizada.", retryable: false, burnsNumber: false },
  "103": { hint: "Lote recebido; aguardando processamento.", retryable: true, burnsNumber: false },
  "104": { hint: "Lote processado.", retryable: false, burnsNumber: false },
  "105": { hint: "Lote em processamento. Consulte novamente em instantes.", retryable: true, burnsNumber: false },
  "106": { hint: "Lote não localizado na SEFAZ. Reenvie o documento.", retryable: true, burnsNumber: false },
  "108": {
    hint: "A SEFAZ está em manutenção. A venda segue em contingência e a nota é transmitida depois.",
    retryable: true,
    burnsNumber: false,
  },
  "109": {
    hint: "O serviço da SEFAZ está paralisado. A venda segue em contingência.",
    retryable: true,
    burnsNumber: false,
  },
  "128": { hint: "Lote de evento recebido.", retryable: false, burnsNumber: false },
  "135": { hint: "Evento registrado e vinculado à nota.", retryable: false, burnsNumber: false },
  "155": { hint: "Cancelamento registrado fora do prazo, mas aceito.", retryable: false, burnsNumber: false },

  // ---- Cadastro da empresa ----
  "204": {
    hint: "Esta nota já foi enviada e autorizada antes. Nenhuma ação necessária.",
    retryable: false,
    burnsNumber: false,
  },
  "206": {
    hint: "Já existe nota autorizada com este número. A numeração avançou; a próxima venda usa o número seguinte.",
    retryable: false,
    burnsNumber: true,
  },
  "207": {
    hint: "O CNPJ do emitente está inválido. Confira o cadastro em Painel > Fiscal.",
    retryable: false,
    burnsNumber: true,
  },
  "209": {
    hint: "A inscrição estadual do emitente está inválida. Confira em Painel > Fiscal.",
    retryable: false,
    burnsNumber: true,
  },
  "210": {
    hint: "A inscrição estadual do destinatário está inválida.",
    retryable: false,
    burnsNumber: true,
  },
  "213": {
    hint: "O CNPJ do emitente não confere com o do certificado digital enviado.",
    retryable: false,
    burnsNumber: true,
  },
  "215": {
    hint: "O arquivo enviado não passou na validação de schema da SEFAZ. Contate o suporte do ChegowIA.",
    retryable: false,
    burnsNumber: true,
  },
  "225": {
    hint: "A estrutura do documento foi recusada pela SEFAZ. Contate o suporte do ChegowIA.",
    retryable: false,
    burnsNumber: true,
  },
  "226": {
    hint: "A UF do emitente não confere com a do cadastro fiscal. Confira em Painel > Fiscal.",
    retryable: false,
    burnsNumber: true,
  },
  "228": {
    hint: "A data de emissão está muito distante da data atual. Confira o relógio do equipamento.",
    retryable: false,
    burnsNumber: true,
  },
  "229": {
    hint: "A inscrição estadual do emitente não é contribuinte de ICMS neste estado.",
    retryable: false,
    burnsNumber: true,
  },
  "233": {
    hint: "O código do município do emitente está incorreto. Confira o código IBGE em Painel > Fiscal.",
    retryable: false,
    burnsNumber: true,
  },
  "236": {
    hint: "A chave de acesso não confere com os dados da nota. Contate o suporte do ChegowIA.",
    retryable: false,
    burnsNumber: true,
  },
  "238": {
    hint: "O certificado digital do emitente é de outro CNPJ. Envie o certificado correto em Painel > Fiscal.",
    retryable: false,
    burnsNumber: true,
  },
  "239": {
    hint: "A versão do layout não é aceita por este estado. Contate o suporte do ChegowIA.",
    retryable: false,
    burnsNumber: true,
  },
  "240": {
    hint: "O certificado digital foi revogado. Providencie um novo com a sua certificadora.",
    retryable: false,
    burnsNumber: true,
  },
  "243": {
    hint: "A assinatura do documento está inválida. Reenvie o certificado em Painel > Fiscal.",
    retryable: false,
    burnsNumber: true,
  },
  "252": {
    hint: "O ambiente informado (homologação ou produção) não confere. Ajuste em Painel > Fiscal.",
    retryable: false,
    burnsNumber: true,
  },
  "280": {
    hint: "O certificado digital está vencido ou inválido. Envie um novo em Painel > Fiscal.",
    retryable: false,
    burnsNumber: true,
  },
  "281": {
    hint: "O certificado digital ainda não é válido — a data de início é futura.",
    retryable: false,
    burnsNumber: true,
  },
  "290": {
    hint: "A cadeia do certificado digital não foi reconhecida. Confirme com a sua certificadora.",
    retryable: false,
    burnsNumber: true,
  },

  // ---- Produto e tributação ----
  "527": {
    hint: "O CFOP não corresponde a uma venda dentro do estado. Ajuste em Painel > Fiscal.",
    retryable: false,
    burnsNumber: true,
  },
  "531": {
    hint: "O total da nota não bate com a soma dos itens. Contate o suporte do ChegowIA.",
    retryable: false,
    burnsNumber: true,
  },
  "533": {
    hint: "O total de ICMS não bate com a soma dos itens. Confira as alíquotas em Painel > Fiscal.",
    retryable: false,
    burnsNumber: true,
  },
  "539": {
    hint: "Já existe uma nota com esta chave e conteúdo diferente. A numeração avançou.",
    retryable: false,
    burnsNumber: true,
  },
  "594": {
    hint: "O NCM informado não existe na tabela oficial. Corrija no cadastro do produto.",
    retryable: false,
    burnsNumber: true,
  },
  "598": {
    hint: "O CSOSN informado não é compatível com o Simples Nacional. Ajuste em Painel > Fiscal.",
    retryable: false,
    burnsNumber: true,
  },
  "610": {
    hint: "O valor total dos produtos não confere com a soma dos itens.",
    retryable: false,
    burnsNumber: true,
  },
  "611": {
    hint: "O valor do item não confere com quantidade × valor unitário.",
    retryable: false,
    burnsNumber: true,
  },
  "630": {
    hint: "O CEST é obrigatório para este NCM. Informe no cadastro do produto.",
    retryable: false,
    burnsNumber: true,
  },
  "778": {
    hint: "O NCM informado não é aceito para este tipo de operação. Corrija no cadastro do produto.",
    retryable: false,
    burnsNumber: true,
  },
  "793": {
    hint: "O CSOSN informado exige informar o crédito do Simples. Ajuste em Painel > Fiscal.",
    retryable: false,
    burnsNumber: true,
  },

  // ---- Específicos de NFC-e ----
  "450": {
    hint: "O modelo do documento está incorreto. Contate o suporte do ChegowIA.",
    retryable: false,
    burnsNumber: true,
  },
  "461": {
    hint: "A NFC-e não aceita destinatário de outro estado. A venda precisa ser interna.",
    retryable: false,
    burnsNumber: true,
  },
  "465": {
    hint: "Este estado limita o valor de uma NFC-e sem identificação do consumidor. Peça o CPF do cliente.",
    retryable: false,
    burnsNumber: true,
  },
  "478": {
    hint: "A NFC-e não permite venda para entrega em outro endereço sem identificar o consumidor.",
    retryable: false,
    burnsNumber: true,
  },
  "776": {
    hint: "O CSC informado é inválido. Confira o identificador e o token em Painel > Fiscal.",
    retryable: false,
    burnsNumber: true,
  },
  "777": {
    hint: "O QR Code não confere com a nota. Confira o CSC em Painel > Fiscal.",
    retryable: false,
    burnsNumber: true,
  },

  // ---- Cancelamento e inutilização ----
  "501": {
    hint: "O prazo de cancelamento venceu — a NFC-e só pode ser cancelada em até 30 minutos neste estado.",
    retryable: false,
    burnsNumber: false,
  },
  "573": {
    hint: "Já existe um cancelamento registrado para esta nota.",
    retryable: false,
    burnsNumber: false,
  },
  "241": {
    hint: "Um evento igual já foi registrado para esta nota.",
    retryable: false,
    burnsNumber: false,
  },
  "563": {
    hint: "Já existe pedido de inutilização para esta faixa de numeração.",
    retryable: false,
    burnsNumber: false,
  },
};

/** Códigos que indicam indisponibilidade e justificam contingência offline. */
const UNAVAILABLE_CODES = new Set(["108", "109", "999"]);

export function rejectionGuidance(code: string | null | undefined, reason?: string | null): RejectionGuidance {
  const normalizado = String(code ?? "").trim();
  const conhecido = GUIDANCE[normalizado];
  if (conhecido) return conhecido;

  // Genérico honesto: diz o código, repete o motivo da SEFAZ e aponta para
  // quem consegue resolver, em vez de fingir que sabe o que fazer.
  return {
    hint: `A SEFAZ recusou a nota (código ${normalizado || "desconhecido"}${reason ? `: ${reason}` : ""}). `
      + "Contate o suporte do ChegowIA com este código.",
    retryable: false,
    burnsNumber: true,
  };
}

export function isServiceUnavailable(code: string | null | undefined) {
  return UNAVAILABLE_CODES.has(String(code ?? "").trim());
}

export function isAuthorized(code: string | null | undefined) {
  const normalizado = String(code ?? "").trim();
  return normalizado === "100" || normalizado === "150";
}

/** 150 é "autorizado fora do prazo" — vale como autorização. */
export function isPending(code: string | null | undefined) {
  const normalizado = String(code ?? "").trim();
  return normalizado === "103" || normalizado === "105";
}
