import { FiscalEnvironment } from "@prisma/client";
import { CalculatedItem, CalculatedTotals, fromCents } from "./tax-engine";
import { consultaUrl } from "./qr-code";

/**
 * DANFE NFC-e — o cupom.
 *
 * Sai como HTML de 80mm em vez de PDF de propósito: quem imprime isso é uma
 * térmica de balcão, que recebe HTML direto do navegador sem intermediário. Um
 * PDF exigiria um renderizador headless no servidor — mais um processo para
 * operar e mais latência entre "venda concluída" e "cupom na mão".
 *
 * O conteúdo obrigatório vem do manual: identificação do emitente, itens com
 * quantidade e valor, totais, forma de pagamento, chave de acesso em blocos de
 * quatro, protocolo de autorização, QR Code e a URL de consulta.
 */

export interface DanfeInput {
  emitterName: string;
  emitterCnpj: string;
  emitterAddress: string;
  emitterState: string;
  environment: FiscalEnvironment;
  accessKey: string;
  series: number;
  number: number;
  issuedAt: Date;
  protocolNumber: string | null;
  authorizedAt: Date | null;
  qrCodeUrl: string;
  items: CalculatedItem[];
  totals: CalculatedTotals;
  payments: Array<{ label: string; amountCents: number }>;
  customerDocument?: string | null;
  /** Contingência: o cupom precisa dizer que a autorização ainda não saiu. */
  offline?: boolean;
}

export function buildDanfeHtml(input: DanfeInput): string {
  const moeda = (cents: number) => fromCents(cents).toFixed(2).replace(".", ",");
  const chaveFormatada = input.accessKey.replace(/(.{4})(?=.)/g, "$1 ");
  const consulta = consultaUrl(input.emitterState, input.environment);

  const itens = input.items
    .map((item, index) => `
      <tr>
        <td class="num">${index + 1}</td>
        <td>${escapeHtml(item.name)}</td>
        <td class="num">${item.quantity.toFixed(3).replace(".", ",")}</td>
        <td class="num">${moeda(item.unitPriceCents)}</td>
        <td class="num">${moeda(item.totalCents)}</td>
      </tr>`)
    .join("");

  const pagamentos = input.payments
    .map((payment) => `<div class="linha"><span>${escapeHtml(payment.label)}</span><span>${moeda(payment.amountCents)}</span></div>`)
    .join("");

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>NFC-e ${input.number}</title>
<style>
  @page { size: 80mm auto; margin: 2mm; }
  body { font-family: "Courier New", monospace; font-size: 11px; width: 76mm; margin: 0 auto; color: #000; }
  h1 { font-size: 12px; text-align: center; margin: 0 0 2px; }
  .centro { text-align: center; }
  .divisor { border-top: 1px dashed #000; margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; border-bottom: 1px solid #000; }
  td { font-size: 10px; padding: 1px 0; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .linha { display: flex; justify-content: space-between; }
  .total { font-weight: bold; font-size: 13px; }
  .chave { word-break: break-all; font-size: 10px; }
  .aviso { border: 1px solid #000; padding: 3px; text-align: center; font-weight: bold; margin: 4px 0; }
</style></head>
<body>
  <h1>${escapeHtml(input.emitterName)}</h1>
  <p class="centro">CNPJ ${formatCnpj(input.emitterCnpj)}<br>${escapeHtml(input.emitterAddress)}</p>
  <div class="divisor"></div>
  <p class="centro">DANFE NFC-e — Documento Auxiliar<br>da Nota Fiscal de Consumidor Eletrônica</p>
  ${input.environment !== FiscalEnvironment.PRODUCAO
    ? '<p class="aviso">EMITIDA EM HOMOLOGACAO<br>SEM VALOR FISCAL</p>'
    : ""}
  ${input.offline ? '<p class="aviso">EMITIDA EM CONTINGENCIA<br>PENDENTE DE AUTORIZACAO</p>' : ""}
  <div class="divisor"></div>

  <table>
    <thead><tr><th>#</th><th>Descrição</th><th class="num">Qtd</th><th class="num">Unit</th><th class="num">Total</th></tr></thead>
    <tbody>${itens}</tbody>
  </table>

  <div class="divisor"></div>
  <div class="linha"><span>Qtd. total de itens</span><span>${input.items.length}</span></div>
  <div class="linha"><span>Subtotal</span><span>${moeda(input.totals.productsCents)}</span></div>
  ${input.totals.deliveryCents > 0 ? `<div class="linha"><span>Entrega</span><span>${moeda(input.totals.deliveryCents)}</span></div>` : ""}
  ${input.totals.discountCents > 0 ? `<div class="linha"><span>Desconto</span><span>-${moeda(input.totals.discountCents)}</span></div>` : ""}
  <div class="linha total"><span>TOTAL R$</span><span>${moeda(input.totals.totalCents)}</span></div>
  <div class="divisor"></div>
  ${pagamentos}
  <div class="divisor"></div>

  <p class="centro">Consulte pela chave de acesso em<br>${escapeHtml(consulta)}</p>
  <p class="chave centro">${chaveFormatada}</p>
  <p class="centro">NFC-e nº ${input.number} — Série ${input.series}<br>${formatDateTime(input.issuedAt)}</p>
  ${input.protocolNumber
    ? `<p class="centro">Protocolo de autorização<br>${escapeHtml(input.protocolNumber)}${input.authorizedAt ? `<br>${formatDateTime(input.authorizedAt)}` : ""}</p>`
    : ""}
  ${input.customerDocument
    ? `<p class="centro">CONSUMIDOR: ${formatDocument(input.customerDocument)}</p>`
    : '<p class="centro">CONSUMIDOR NAO IDENTIFICADO</p>'}

  <div class="divisor"></div>
  <div class="centro" id="qrcode" data-url="${escapeHtml(input.qrCodeUrl)}"></div>
  <p class="chave centro">${escapeHtml(input.qrCodeUrl)}</p>
  <p class="centro">Tributos aprox.: R$ ${moeda(input.totals.approximateTaxCents)} (Lei 12.741/2012)</p>
</body></html>`;
}

/**
 * Versão em texto puro para impressoras ESC/POS que não renderizam HTML.
 * Mesmo conteúdo, 48 colunas.
 */
export function buildDanfeText(input: DanfeInput): string {
  const moeda = (cents: number) => fromCents(cents).toFixed(2).replace(".", ",");
  const linha = (esquerda: string, direita: string) => {
    const espacos = Math.max(1, 48 - esquerda.length - direita.length);
    return `${esquerda}${" ".repeat(espacos)}${direita}`;
  };
  const centro = (texto: string) => texto.padStart(Math.floor((48 + texto.length) / 2)).padEnd(48);

  const partes: string[] = [
    centro(input.emitterName.slice(0, 48)),
    centro(`CNPJ ${formatCnpj(input.emitterCnpj)}`),
    centro(input.emitterAddress.slice(0, 48)),
    "-".repeat(48),
    centro("DANFE NFC-e"),
  ];
  if (input.environment !== FiscalEnvironment.PRODUCAO) partes.push(centro("*** HOMOLOGACAO - SEM VALOR FISCAL ***"));
  if (input.offline) partes.push(centro("*** CONTINGENCIA - PENDENTE ***"));
  partes.push("-".repeat(48));

  input.items.forEach((item, index) => {
    partes.push(`${String(index + 1).padStart(3, "0")} ${item.name.slice(0, 43)}`);
    partes.push(linha(
      `    ${item.quantity.toFixed(3)} x ${moeda(item.unitPriceCents)}`,
      moeda(item.totalCents),
    ));
  });

  partes.push("-".repeat(48));
  partes.push(linha("Subtotal", moeda(input.totals.productsCents)));
  if (input.totals.deliveryCents > 0) partes.push(linha("Entrega", moeda(input.totals.deliveryCents)));
  if (input.totals.discountCents > 0) partes.push(linha("Desconto", `-${moeda(input.totals.discountCents)}`));
  partes.push(linha("TOTAL R$", moeda(input.totals.totalCents)));
  partes.push("-".repeat(48));
  for (const payment of input.payments) partes.push(linha(payment.label, moeda(payment.amountCents)));
  partes.push("-".repeat(48));
  partes.push(centro(`NFC-e ${input.number} Serie ${input.series}`));
  partes.push(centro(formatDateTime(input.issuedAt)));
  partes.push(input.accessKey.replace(/(.{4})(?=.)/g, "$1 "));
  if (input.protocolNumber) partes.push(centro(`Protocolo ${input.protocolNumber}`));
  partes.push(centro(input.customerDocument ? `CPF/CNPJ ${formatDocument(input.customerDocument)}` : "CONSUMIDOR NAO IDENTIFICADO"));
  partes.push(input.qrCodeUrl);
  partes.push(centro(`Trib. aprox. R$ ${moeda(input.totals.approximateTaxCents)}`));

  return partes.join("\n");
}

function formatCnpj(value: string) {
  const digitos = value.toUpperCase().replace(/[^A-Z0-9]/g, "").padStart(14, "0");
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
}

function formatDocument(value: string) {
  const digitos = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (digitos.length === 14) return formatCnpj(digitos);
  return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
}

function formatDateTime(date: Date) {
  return date.toLocaleString("pt-BR", { timeZone: process.env.BUSINESS_TIMEZONE ?? "America/Sao_Paulo" });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[char] ?? char);
}
