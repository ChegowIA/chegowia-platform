/**
 * Leitura da lista de contatos colada na tela de prospecção.
 *
 * O campo aceita o que a pessoa tem em mãos, não um formato: uma coluna copiada
 * de planilha, um bloco do caderno, linhas com nome e cidade antes do telefone.
 * O que não pode acontecer é adivinhar dígito — mensagem comercial para o número
 * errado chega em um desconhecido, e a Meta conta isso contra a reputação do
 * número institucional.
 *
 * Por isso aqui nada é inferido por modelo de linguagem: número que não fecha em
 * um formato brasileiro válido volta como recusado, com o trecho original, para
 * quem colou conferir. A IA entra depois, na conversa.
 */

/** DDDs que existem de fato. Sem esta lista, "00 99999-8888" viraria um envio. */
const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/** Rótulos que aparecem antes do número e não são nome de ninguém. */
const RUIDO_DE_ROTULO = /\b(tel|telefone|fone|cel|celular|whats(app)?|zap|contato|numero|número)\b\s*:?\s*/gi;

/** Separadores entre nome, cidade e outros pedaços de um mesmo contato. */
const SEPARADORES_DE_ROTULO = /[-–—|/;,\t]+/;

export type ContatoLido = {
  phone: string;
  name: string | null;
  city: string | null;
};

export type TrechoRecusado = {
  texto: string;
  motivo: string;
};

export type LeituraDeContatos = {
  contatos: ContatoLido[];
  recusados: TrechoRecusado[];
  /** Quantas vezes o mesmo número apareceu de novo na própria lista. */
  repetidos: number;
  /** Números que parecem telefone fixo — costumam não ter WhatsApp. */
  possiveisFixos: string[];
};

/**
 * Normaliza para o formato que o provedor espera: 55 + DDD + número, sem sinal.
 *
 * Devolve null quando o que sobrou não fecha em um telefone brasileiro. O
 * chamador precisa distinguir "não é telefone" de "é telefone e está pronto".
 */
export function normalizarTelefoneBrasileiro(bruto: string): string | null {
  const digitos = bruto.replace(/\D/g, "");
  const semCodigoPais = digitos.length >= 12 && digitos.startsWith("55")
    ? digitos.slice(2)
    : digitos;
  if (semCodigoPais.length !== 10 && semCodigoPais.length !== 11) return null;
  const ddd = Number(semCodigoPais.slice(0, 2));
  if (!DDDS_VALIDOS.has(ddd)) return null;
  const assinante = semCodigoPais.slice(2);
  // Celular de 9 dígitos começa em 9; de 8 dígitos (numeração antiga) começa
  // entre 6 e 9. Fixo começa entre 2 e 5 e passa igual, só sinalizado depois.
  if (assinante.length === 9 && !/^9/.test(assinante)) return null;
  if (!/^[2-9]/.test(assinante)) return null;
  return `55${semCodigoPais}`;
}

/** Fixo não recebe mensagem de WhatsApp na quase totalidade dos casos. */
export function pareceTelefoneFixo(telefone: string) {
  const assinante = telefone.slice(4);
  return assinante.length === 8 && /^[2-5]/.test(assinante);
}

/**
 * Quebra uma sequência longa de dígitos em telefones.
 *
 * Acontece quando a linha traz vários números separados só por espaço: o bloco
 * chega aqui como um dígito só. Consome da esquerda tentando o tamanho maior
 * primeiro, porque 11 dígitos é o caso comum e 13 aparece quando o país veio
 * junto.
 */
function fatiarSequenciaDeTelefones(digitos: string): string[] | null {
  const encontrados: string[] = [];
  let restante = digitos;
  while (restante.length > 0) {
    const tamanho = [13, 12, 11, 10].find((candidato) => {
      if (restante.length < candidato) return false;
      return normalizarTelefoneBrasileiro(restante.slice(0, candidato)) !== null;
    });
    if (!tamanho) return null;
    encontrados.push(normalizarTelefoneBrasileiro(restante.slice(0, tamanho))!);
    restante = restante.slice(tamanho);
  }
  return encontrados.length ? encontrados : null;
}

/** Nome e cidade do que sobrou da linha depois de tirar os números. */
function lerRotulo(resto: string): { name: string | null; city: string | null } {
  const limpo = resto
    .replace(RUIDO_DE_ROTULO, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limpo) return { name: null, city: null };
  const pedacos = limpo
    .split(SEPARADORES_DE_ROTULO)
    // Aspas e a pontuação que sobra de "Padaria Central: 62 …" não fazem parte
    // do nome, e entrariam no {{1}} do modelo aprovado do jeito que estivessem.
    .map((pedaco) => pedaco.trim().replace(/^["'`:.\s]+|["'`:.\s]+$/g, "").trim())
    // Sobra de pontuação ("-", ":") não é nome nem cidade.
    .filter((pedaco) => pedaco.length > 1 && /[a-zà-ú]/i.test(pedaco));
  if (!pedacos.length) return { name: null, city: null };
  return {
    name: pedacos[0].slice(0, 120),
    city: pedacos[1] ? pedacos[1].slice(0, 80) : null,
  };
}

/**
 * Lê a lista inteira.
 *
 * A ordem de chegada é preservada: quem colou uma planilha ordenada espera ver
 * o disparo seguir aquela ordem.
 */
export function lerListaDeContatos(bruto: string): LeituraDeContatos {
  const contatos: ContatoLido[] = [];
  const recusados: TrechoRecusado[] = [];
  const possiveisFixos: string[] = [];
  const vistos = new Set<string>();
  let repetidos = 0;

  for (const linhaBruta of (bruto ?? "").split(/\r?\n/)) {
    const linha = linhaBruta.trim();
    if (!linha) continue;

    // Blocos que podem ser telefone: dígitos com a pontuação que costuma
    // acompanhá-los. O `+` fica fora do grupo interno para não colar dois
    // números escritos como "+5562... +5562...".
    const blocos = linha.match(/\+?\d[\d\s().-]{7,}\d/g) ?? [];
    const telefonesDaLinha: string[] = [];
    for (const bloco of blocos) {
      const digitos = bloco.replace(/\D/g, "");
      const direto = normalizarTelefoneBrasileiro(digitos);
      if (direto) {
        telefonesDaLinha.push(direto);
        continue;
      }
      const fatiados = fatiarSequenciaDeTelefones(digitos);
      if (fatiados) telefonesDaLinha.push(...fatiados);
    }

    if (!telefonesDaLinha.length) {
      recusados.push({
        texto: linha.slice(0, 120),
        motivo: blocos.length
          ? "número fora de um formato brasileiro válido"
          : "linha sem telefone",
      });
      continue;
    }

    // O rótulo vale para todos os números da linha: duas linhas de telefone do
    // mesmo estabelecimento é o caso comum, e não há como saber qual é de quem.
    let resto = linha;
    for (const bloco of blocos) resto = resto.replace(bloco, " ");
    const { name, city } = lerRotulo(resto);

    for (const telefone of telefonesDaLinha) {
      if (vistos.has(telefone)) {
        repetidos += 1;
        continue;
      }
      vistos.add(telefone);
      if (pareceTelefoneFixo(telefone)) possiveisFixos.push(telefone);
      contatos.push({ phone: telefone, name, city });
    }
  }

  return { contatos, recusados, repetidos, possiveisFixos };
}

/** Como o número aparece na tela: (62) 99999-8888. */
export function formatarTelefoneParaExibicao(telefone: string) {
  const semPais = telefone.startsWith("55") ? telefone.slice(2) : telefone;
  const ddd = semPais.slice(0, 2);
  const assinante = semPais.slice(2);
  if (assinante.length === 9) return `(${ddd}) ${assinante.slice(0, 5)}-${assinante.slice(5)}`;
  if (assinante.length === 8) return `(${ddd}) ${assinante.slice(0, 4)}-${assinante.slice(4)}`;
  return telefone;
}

/**
 * Pedidos explícitos de não receber mais.
 *
 * Só entram frases que não têm outra leitura. "Não tenho interesse" ficou de
 * fora de propósito: é um não para esta oferta, respondido pelo assistente, e
 * não um pedido de bloqueio permanente — e quem já conversou nunca volta para
 * uma lista de prospecção, então não há risco de reabordagem.
 */
const PEDIDOS_DE_SAIDA = [
  /\bsai[r]? da lista\b/,
  /\bme (tira|tire|remova|remove|exclui|exclua)\b/,
  /\bdescadastr/,
  /\bnao (quero|queria) (mais )?receber\b/,
  /\bnao me (manda|mande|envie|envia)\b/,
  /\b(para|pare|parem) de (me )?(mandar|enviar)\b/,
  /\bnunca mais\b/,
  /\bpara de me (perturbar|incomodar)\b/,
  /^stop$/,
  /\bcancelar inscricao\b/,
];

export function pediuParaNaoReceber(texto: string) {
  const normalizado = (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!normalizado) return false;
  return PEDIDOS_DE_SAIDA.some((padrao) => padrao.test(normalizado));
}

/**
 * Preenche {{1}}, {{2}}… do modelo aprovado com os valores enviados.
 *
 * Serve para guardar no histórico o texto que a pessoa recebeu de fato. Sem
 * isso, o inbox mostraria a conversa começando pela resposta dela, sem a
 * pergunta — e quem fosse atender não saberia o que foi dito.
 */
export function renderizarModelo(corpo: string | null | undefined, variaveis: string[]) {
  if (!corpo) return null;
  return corpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (original, indice) => {
    const valor = variaveis[Number(indice) - 1];
    return valor === undefined ? original : valor;
  });
}
