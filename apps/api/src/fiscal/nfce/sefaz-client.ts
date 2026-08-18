import { Agent, request as httpsRequest } from "node:https";
import { randomInt } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { FiscalEnvironment } from "@prisma/client";
import { create } from "xmlbuilder2";
import { sefazEndpoints } from "./sefaz-endpoints";
import { UF_CODES } from "./access-key";

/**
 * Cliente SOAP da SEFAZ.
 *
 * Três coisas que a comunicação com a SEFAZ exige e que não são óbvias:
 *
 * 1. **TLS mútuo.** O cliente se autentica com o mesmo certificado A1 que
 *    assina o XML. Não há token nem chave de API: quem prova a identidade é o
 *    certificado, então cada requisição precisa do .pfx em memória.
 *
 * 2. **Timeout curto e agressivo.** Uma NFC-e é emitida com o cliente parado
 *    no balcão. Esperar 60 segundos por um servidor estadual instável é pior
 *    do que cair em contingência offline em 8 e imprimir o cupom.
 *
 * 3. **A mensagem vai embrulhada em `nfeDadosMsg`.** O WSDL de cada serviço
 *    declara esse elemento com o namespace do próprio serviço; mandar o
 *    `enviNFe` solto no corpo do envelope faz o servidor recusar a requisição
 *    antes de olhar a nota. E, em SOAP 1.2, a ação vai como parâmetro do
 *    `Content-Type` — os serviços estaduais são ASP.NET e recusam a ação
 *    apenas no cabeçalho `SOAPAction`, que é a forma do SOAP 1.1.
 *
 * 4. **A resposta é SOAP com XML embutido.** O corpo útil vem dentro do
 *    envelope, e cada estado nomeia o wrapper de um jeito. Por isso a extração
 *    procura pela tag de negócio (`retEnviNFe` etc.) em vez de navegar o
 *    envelope.
 */

const DEFAULT_TIMEOUT_MS = 8_000;

/** Namespace declarado no WSDL de cada serviço, usado no `nfeDadosMsg`. */
const WSDL_NAMESPACE = "http://www.portalfiscal.inf.br/nfe/wsdl";

/**
 * Identificador de lote.
 *
 * O schema exige `[0-9]{1,15}` — qualquer letra é rejeição 225 antes de a
 * SEFAZ olhar a nota. O carimbo de tempo em milissegundos tem 13 dígitos e já
 * é crescente; os dois dígitos aleatórios cobrem dois envios no mesmo
 * milissegundo.
 */
export function generateLotId(): string {
  const sufixo = String(randomInt(0, 100)).padStart(2, "0");
  return `${Date.now()}${sufixo}`.slice(-15);
}

export class SefazUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "SefazUnavailableError";
  }
}

export interface SefazCredentials {
  pfx: Buffer;
  password: string;
}

export interface SefazContext {
  uf: string;
  environment: FiscalEnvironment;
  credentials: SefazCredentials;
}

export interface SefazResponse {
  /** cStat da resposta. */
  code: string | null;
  /** xMotivo da resposta. */
  reason: string | null;
  /** XML de negócio já extraído do envelope SOAP. */
  xml: string;
}

@Injectable()
export class SefazClient {
  private readonly logger = new Logger(SefazClient.name);

  /** Envio síncrono do lote (indSinc=1): a NFC-e não espera processamento. */
  async sendAuthorization(context: SefazContext, signedNfeXml: string, lotId: string): Promise<SefazResponse> {
    const enviNFe = create({ version: "1.0", encoding: "UTF-8" })
      .ele("enviNFe", { xmlns: "http://www.portalfiscal.inf.br/nfe", versao: "4.00" })
      .ele("idLote").txt(lotId).up()
      .ele("indSinc").txt("1").up()
      .up()
      .end({ prettyPrint: false, headless: true });

    // O XML da nota entra dentro do enviNFe; concatenar é mais previsível do
    // que reparsear e reserializar, que quebraria a assinatura já calculada.
    const corpo = enviNFe.replace("</enviNFe>", `${stripDeclaration(signedNfeXml)}</enviNFe>`);

    return this.post(
      context,
      sefazEndpoints(context.uf, context.environment).autorizacao,
      { service: "NFeAutorizacao4", method: "nfeAutorizacaoLote" },
      corpo,
      ["retEnviNFe"],
    );
  }

  /** Consulta a situação de uma nota pela chave. */
  async consultProtocol(context: SefazContext, accessKey: string): Promise<SefazResponse> {
    const corpo = create({ version: "1.0", encoding: "UTF-8" })
      .ele("consSitNFe", { xmlns: "http://www.portalfiscal.inf.br/nfe", versao: "4.00" })
      .ele("tpAmb").txt(ambiente(context.environment)).up()
      .ele("xServ").txt("CONSULTAR").up()
      .ele("chNFe").txt(accessKey).up()
      .up()
      .end({ prettyPrint: false, headless: true });

    return this.post(
      context,
      sefazEndpoints(context.uf, context.environment).consultaProtocolo,
      { service: "NFeConsultaProtocolo4", method: "nfeConsultaNF" },
      corpo,
      ["retConsSitNFe"],
    );
  }

  /** Cancelamento e carta de correção compartilham o serviço de eventos. */
  async sendEvent(context: SefazContext, signedEventXml: string, lotId: string): Promise<SefazResponse> {
    const envio = create({ version: "1.0", encoding: "UTF-8" })
      .ele("envEvento", { xmlns: "http://www.portalfiscal.inf.br/nfe", versao: "1.00" })
      .ele("idLote").txt(lotId).up()
      .up()
      .end({ prettyPrint: false, headless: true });
    const corpo = envio.replace("</envEvento>", `${stripDeclaration(signedEventXml)}</envEvento>`);

    return this.post(
      context,
      sefazEndpoints(context.uf, context.environment).recepcaoEvento,
      { service: "NFeRecepcaoEvento4", method: "nfeRecepcaoEvento" },
      corpo,
      ["retEnvEvento"],
    );
  }

  async sendInutilization(context: SefazContext, signedXml: string): Promise<SefazResponse> {
    return this.post(
      context,
      sefazEndpoints(context.uf, context.environment).inutilizacao,
      { service: "NFeInutilizacao4", method: "nfeInutilizacaoNF" },
      stripDeclaration(signedXml),
      ["retInutNFe"],
    );
  }

  /**
   * Status do serviço. É o que decide entre emitir normalmente e cair em
   * contingência, então tem timeout ainda mais curto: se a SEFAZ demora para
   * dizer que está no ar, para o caixa ela já está fora.
   */
  async serviceStatus(context: SefazContext): Promise<SefazResponse> {
    const corpo = create({ version: "1.0", encoding: "UTF-8" })
      .ele("consStatServ", { xmlns: "http://www.portalfiscal.inf.br/nfe", versao: "4.00" })
      .ele("tpAmb").txt(ambiente(context.environment)).up()
      .ele("cUF").txt(UF_CODES[context.uf.toUpperCase()] ?? "").up()
      .ele("xServ").txt("STATUS").up()
      .up()
      .end({ prettyPrint: false, headless: true });

    return this.post(
      context,
      sefazEndpoints(context.uf, context.environment).statusServico,
      { service: "NFeStatusServico4", method: "nfeStatusServicoNF" },
      corpo,
      ["retConsStatServ"],
      4_000,
    );
  }

  private async post(
    context: SefazContext,
    url: string,
    operation: { service: string; method: string },
    body: string,
    resultTags: string[],
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<SefazResponse> {
    const namespace = `${WSDL_NAMESPACE}/${operation.service}`;
    const soapAction = `${namespace}/${operation.method}`;
    const envelope = soapEnvelope(`<nfeDadosMsg xmlns="${namespace}">${body}</nfeDadosMsg>`);
    const alvo = new URL(url);

    const raw = await new Promise<string>((resolve, reject) => {
      const req = httpsRequest(
        {
          host: alvo.hostname,
          port: alvo.port || 443,
          path: `${alvo.pathname}${alvo.search}`,
          method: "POST",
          headers: {
            // A ação no Content-Type é a forma do SOAP 1.2, que é o que os
            // serviços estaduais falam. O SOAPAction fica junto porque alguns
            // proxies ainda roteiam por ele, e o cabeçalho a mais é inofensivo.
            "Content-Type": `application/soap+xml; charset=utf-8; action="${soapAction}"`,
            "Content-Length": Buffer.byteLength(envelope),
            SOAPAction: soapAction,
          },
          agent: new Agent({
            pfx: context.credentials.pfx,
            passphrase: context.credentials.password,
            // Alguns servidores estaduais ainda negociam TLS antigo; recusar
            // renegociação insegura é o único ajuste feito.
            keepAlive: false,
          }),
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const texto = Buffer.concat(chunks).toString("utf8");
            if ((res.statusCode ?? 500) >= 400) {
              reject(new SefazUnavailableError(`SEFAZ respondeu HTTP ${res.statusCode}.`));
              return;
            }
            resolve(texto);
          });
        },
      );
      req.on("timeout", () => {
        req.destroy();
        reject(new SefazUnavailableError(`A SEFAZ não respondeu em ${timeoutMs}ms.`));
      });
      req.on("error", (error) => reject(new SefazUnavailableError("Falha de comunicação com a SEFAZ.", error)));
      req.write(envelope);
      req.end();
    });

    const xml = extractResult(raw, resultTags);
    return { code: tagValue(xml, "cStat"), reason: tagValue(xml, "xMotivo"), xml };
  }
}

function soapEnvelope(body: string) {
  return `<?xml version="1.0" encoding="utf-8"?>`
    + `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">`
    + `<soap12:Body>${body}</soap12:Body></soap12:Envelope>`;
}

function stripDeclaration(xml: string) {
  return xml.replace(/^<\?xml[^>]*\?>/, "").trim();
}

function ambiente(environment: FiscalEnvironment) {
  return environment === FiscalEnvironment.PRODUCAO ? "1" : "2";
}

/**
 * Extrai o XML de negócio do envelope SOAP.
 *
 * Cada estado embrulha a resposta com um nome diferente de wrapper, então
 * procurar a tag de negócio pelo nome é mais robusto do que navegar o
 * envelope por caminho fixo.
 */
export function extractResult(soap: string, tags: string[]): string {
  for (const tag of tags) {
    const match = soap.match(new RegExp(`<(?:\\w+:)?${tag}[\\s>][\\s\\S]*?</(?:\\w+:)?${tag}>`));
    if (match) return match[0];
  }
  return soap;
}

/** Primeira ocorrência de uma tag simples, ignorando prefixo de namespace. */
export function tagValue(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<(?:\\w+:)?${tag}>([^<]*)</(?:\\w+:)?${tag}>`));
  return match ? match[1].trim() : null;
}
