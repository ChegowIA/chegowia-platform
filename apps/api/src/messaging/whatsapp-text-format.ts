const MAX_WHATSAPP_TEXT_LENGTH = 4096;

/**
 * Converte o texto do modelo para a formatação que o WhatsApp entende.
 *
 * O modelo escreve em Markdown por hábito, mas o WhatsApp usa outra convenção:
 * negrito é `*um asterisco*`, não `**dois**`. Sem conversão, o cliente lê os
 * asteriscos literalmente — e, pior, quando eles envolvem uma URL o aplicativo
 * deixa de reconhecer o link, porque o asterisco cola no endereço.
 *
 * A ordem das substituições importa: negrito duplo precisa ser tratado antes do
 * itálico simples, senão `**texto**` viraria `*texto*` só na borda externa.
 */
export function formatForWhatsapp(value: string) {
  let text = value.trim();

  // Blocos de código com linguagem (```ts) perdem o rótulo: o WhatsApp não o
  // interpreta e ele apareceria como primeira linha do bloco.
  text = text.replace(/```[a-zA-Z]*\n/g, "```\n");

  // Títulos de Markdown não existem no WhatsApp. Viram negrito, que é o efeito
  // pretendido de destaque de seção.
  text = text.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, "*$1*");

  // Link em Markdown: o WhatsApp já transforma URL solta em link, então o rótulo
  // só polui. Mantemos o texto e a URL separados por travessão curto.
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_all, label: string, url: string) => {
    const cleanLabel = label.trim();
    return cleanLabel && cleanLabel !== url ? `${cleanLabel}: ${url}` : url;
  });

  // Negrito e itálico do Markdown para a convenção do WhatsApp.
  text = text.replace(/\*\*\*(.+?)\*\*\*/gs, "*_$1_*");
  text = text.replace(/\*\*(.+?)\*\*/gs, "*$1*");
  text = text.replace(/__(.+?)__/gs, "*$1*");
  // Itálico com underscore só quando cercado por limite de palavra, para não
  // estragar nome_de_variavel ou parte de URL.
  text = text.replace(/(^|[\s(])_([^\s_][^_]*?)_(?=[\s.,!?)]|$)/gm, "$1_$2_");

  // Marcadores de lista: o hífen no início da linha fica pobre no aplicativo.
  text = text.replace(/^\s*[-*+]\s+/gm, "• ");

  // Travessão longo quebra a leitura em tela estreita e costuma vir do modelo,
  // não do português corrente da equipe.
  text = text.replace(/\s*—\s*/g, " - ");
  text = text.replace(/\s*–\s*/g, " - ");

  // Asterisco ou underscore colado em URL impede o WhatsApp de reconhecer o
  // link. Acontece quando o modelo tenta destacar o endereço.
  text = text.replace(/([*_~])+(https?:\/\/[^\s*_~]+)([*_~])+/g, "$2");

  // Ênfase vazia sobra das conversões acima e apareceria como lixo.
  text = text.replace(/(^|\s)\*\s*\*(\s|$)/g, "$1$2");

  // Três ou mais linhas em branco viram duas: o WhatsApp não colapsa e a
  // mensagem fica com buracos.
  text = text.replace(/\n{3,}/g, "\n\n");
  // Espaço à direita de cada linha é invisível aqui e visível no aplicativo.
  text = text.replace(/[ \t]+$/gm, "");

  return text.trim().slice(0, MAX_WHATSAPP_TEXT_LENGTH);
}
