export const BRAZIL_STATES = [
  ["AC", "Acre"], ["AL", "Alagoas"], ["AP", "Amapá"], ["AM", "Amazonas"], ["BA", "Bahia"],
  ["CE", "Ceará"], ["DF", "Distrito Federal"], ["ES", "Espírito Santo"], ["GO", "Goiás"],
  ["MA", "Maranhão"], ["MT", "Mato Grosso"], ["MS", "Mato Grosso do Sul"], ["MG", "Minas Gerais"],
  ["PA", "Pará"], ["PB", "Paraíba"], ["PR", "Paraná"], ["PE", "Pernambuco"], ["PI", "Piauí"],
  ["RJ", "Rio de Janeiro"], ["RN", "Rio Grande do Norte"], ["RS", "Rio Grande do Sul"],
  ["RO", "Rondônia"], ["RR", "Roraima"], ["SC", "Santa Catarina"], ["SP", "São Paulo"],
  ["SE", "Sergipe"], ["TO", "Tocantins"],
] as const;

const digits = (value: string) => value.replace(/\D/g, "");

export function formatPhone(value: string) {
  const raw = digits(value).slice(0, 11);
  if (raw.length <= 2) return raw ? `(${raw}` : "";
  if (raw.length <= 6) return `(${raw.slice(0, 2)}) ${raw.slice(2)}`;
  if (raw.length <= 10) return `(${raw.slice(0, 2)}) ${raw.slice(2, 6)}-${raw.slice(6)}`;
  return `(${raw.slice(0, 2)}) ${raw.slice(2, 7)}-${raw.slice(7)}`;
}

export function formatDocument(value: string) {
  const raw = digits(value).slice(0, 14);
  if (raw.length <= 11) {
    return raw.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  return raw.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
}

export function formatCep(value: string) {
  return digits(value).slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");
}

export function formatInteger(value: string, maxLength = 8) {
  return digits(value).slice(0, maxLength);
}

/**
 * Máscara de moeda que digita da direita para a esquerda, como maquininha e
 * caixa eletrônico: cada tecla empurra o valor uma casa. Digitar `1`, `5`, `0`
 * produz `1,50`.
 *
 * O motivo de não usar `<input type="number">`: no campo numérico o separador
 * decimal depende do teclado do sistema, então parte dos usuários digitaria
 * ponto e veria o valor recusado. Com máscara, quem opera o caixa não precisa
 * pensar em separador nenhum.
 */
export function formatCurrencyInput(value: string) {
  const raw = digits(value).slice(0, 11);
  if (!raw) return "";
  const cents = Number(raw);
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Converte o texto mascarado de volta para número. `"1.234,56"` → `1234.56`. */
export function parseCurrencyInput(value: string) {
  const raw = digits(value);
  return raw ? Number(raw) / 100 : 0;
}
