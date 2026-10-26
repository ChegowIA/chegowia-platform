import { renderizarModelo } from "./outreach-contacts";

/** Número pelo qual a prospecção sai: o mesmo do atendimento comercial. */
export const PLATFORM_CHANNEL_KEY = "chegowia-institucional";

/**
 * Modelo de abertura da prospecção, submetido à Meta pelo próprio sistema.
 *
 * O texto é fixo depois de aprovado; a personalização acontece só nas
 * variáveis. Mudar qualquer palavra aqui exige um nome novo (`_v2`), porque a
 * Meta não deixa editar o conteúdo de um modelo aprovado sem nova revisão.
 */
export const OUTREACH_TEMPLATE = {
  name: "chegowia_prospeccao_v1",
  languageCode: "pt_BR",
  category: "MARKETING",
  body: [
    "Oi, {{1}}! Tudo bem? Aqui é da ChegowIA.",
    "",
    "Vi que vocês trabalham com {{2}} em {{3}} e lembrei de vocês: a ChegowIA atende seus clientes no WhatsApp com inteligência artificial, monta o pedido com cardápio, adicionais e entrega, e manda tudo organizado para o seu painel, sem ninguém precisar ficar digitando.",
    "",
    "No mesmo sistema você também tem pedido por QR Code na mesa, acompanhamento dos motoboys e indicadores do negócio.",
    "",
    "Posso te mostrar como isso funcionaria na prática aí?",
  ].join("\n"),
  footer: "ChegowIA · pedidos e atendimento com IA",
  buttons: ["Quero ver como funciona", "Agora não", "Não quero receber"],
  exampleValues: ["Pizzaria Sabor Italiano", "pizzas e delivery", "Goiânia"],
} as const;

/** Reservas que mantêm a frase correta quando falta o dado. A Meta recusa parâmetro vazio. */
export const OUTREACH_VARIABLE_FALLBACKS = ["pessoal", "alimentação", "sua região"] as const;

export function renderOutreachTemplate(variables: readonly string[]) {
  return renderizarModelo(OUTREACH_TEMPLATE.body, [...variables])!;
}

export function outreachTemplateExample() {
  return renderOutreachTemplate(OUTREACH_TEMPLATE.exampleValues);
}

const LIMITES = { nomeCurto: [2, 40], atividade: [3, 60] } as const;
const PROMESSAS = /\b(garantid[oa]|gr[aá]tis|dobr(ar|e)|triplic(ar|e)|faturamento|desconto|promo[cç][aã]o|\d+%|R\$)\b/i;

/**
 * Valor que vai dentro do modelo aprovado.
 *
 * A Meta recusa parâmetro com quebra de linha, tabulação ou mais de quatro
 * espaços seguidos, e um valor que pareça texto de busca estraga a frase
 * inteira. O que não passa aqui volta para a IA ou para revisão manual.
 */
export function validateOutreachVariable(campo: keyof typeof LIMITES, raw: unknown) {
  if (typeof raw !== "string") throw new Error(`${campo} ausente.`);
  const valor = raw.trim().replace(/\s+/g, " ");
  const [min, max] = LIMITES[campo];
  if (valor.length < min || valor.length > max) throw new Error(`${campo} deve ter entre ${min} e ${max} caracteres.`);
  if (/[\n\r\t{}<>#|@]|https?:|www\.|\d{6,}/i.test(raw)) throw new Error(`${campo} contém caractere, link ou número não permitido.`);
  if (/\p{Extended_Pictographic}/u.test(valor)) throw new Error(`${campo} não pode ter emoji.`);
  if (PROMESSAS.test(valor)) throw new Error(`${campo} contém promessa comercial.`);
  // Começa minúscula para encaixar no meio da frase: "trabalham com pizzas".
  return campo === "atividade" ? valor.charAt(0).toLowerCase() + valor.slice(1) : valor;
}

export function outreachVariables(input: { nomeCurto: unknown; atividade: unknown; cidade: string | null }) {
  return [
    validateOutreachVariable("nomeCurto", input.nomeCurto),
    validateOutreachVariable("atividade", input.atividade),
    input.cidade?.trim() || OUTREACH_VARIABLE_FALLBACKS[2],
  ];
}
