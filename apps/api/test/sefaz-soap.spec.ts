import { EventEmitter } from "node:events";
import { FiscalEnvironment, PaymentMethod } from "@prisma/client";
import { SefazClient } from "../src/fiscal/nfce/sefaz-client";
import { reconcilePayments } from "../src/fiscal/nfce/nfce.service";

/**
 * O que a SEFAZ recebe.
 *
 * O envelope é a parte do fluxo que nenhum teste de XML alcança: a nota pode
 * estar perfeita e a requisição ser recusada antes de a SEFAZ olhar para ela.
 * Estas asserções cobrem os dois detalhes que decidem isso — o `nfeDadosMsg`
 * com o namespace do serviço e a ação no `Content-Type`, que é como o SOAP 1.2
 * a transporta.
 */
const enviado: { headers?: Record<string, unknown>; body?: string; options?: any } = {};

jest.mock("node:https", () => ({
  Agent: class {
    constructor(public options: Record<string, unknown>) {}
  },
  request: (options: any, callback: (res: unknown) => void) => {
    const req: any = new EventEmitter();
    req.write = (chunk: string) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      Object.assign(require("./sefaz-soap.capture"), { headers: options.headers, body: chunk, options });
    };
    req.end = () => {
      const res: any = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      setImmediate(() => {
        res.emit("data", Buffer.from(
          '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>'
          + '<retEnviNFe versao="4.00"><cStat>104</cStat><xMotivo>Lote processado</xMotivo>'
          + "</retEnviNFe></soap:Body></soap:Envelope>",
        ));
        res.emit("end");
      });
    };
    req.destroy = () => undefined;
    return req;
  },
}));

const capture = require("./sefaz-soap.capture");

const NFE_ASSINADA = '<?xml version="1.0" encoding="UTF-8"?>'
  + '<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe versao="4.00" Id="NFe123"><ide><cUF>31</cUF></ide></infNFe></NFe>';

const contexto = {
  uf: "MG",
  environment: FiscalEnvironment.PRODUCAO,
  credentials: { pfx: Buffer.from("x"), password: "senha" },
};

describe("envelope SOAP enviado à SEFAZ", () => {
  const client = new SefazClient();

  it("a mensagem vai dentro de nfeDadosMsg, com o namespace do serviço", async () => {
    await client.sendAuthorization(contexto, NFE_ASSINADA, "123456789012345");

    expect(capture.body).toContain(
      '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">',
    );
    expect(capture.body).toContain("<enviNFe");
    expect(capture.body).toContain("</nfeDadosMsg>");
  });

  it("a ação vai no Content-Type, que é como o SOAP 1.2 a transporta", async () => {
    await client.sendAuthorization(contexto, NFE_ASSINADA, "123456789012345");

    expect(capture.headers["Content-Type"]).toBe(
      'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote"',
    );
  });

  it("o XML assinado entra sem a declaração, que quebraria o envelope", async () => {
    await client.sendAuthorization(contexto, NFE_ASSINADA, "123456789012345");

    expect(capture.body.indexOf("<?xml")).toBe(0);
    expect(capture.body.match(/<\?xml/g)).toHaveLength(1);
  });

  it("cada serviço usa o seu próprio namespace", async () => {
    await client.serviceStatus(contexto);
    expect(capture.body).toContain('xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4"');

    await client.consultProtocol(contexto, "31260812345678000199650010000000421123456780");
    expect(capture.body).toContain('xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4"');
  });

  it("o certificado da empresa vai no TLS da requisição", async () => {
    await client.sendAuthorization(contexto, NFE_ASSINADA, "123456789012345");

    expect(capture.options.agent.options.pfx).toBe(contexto.credentials.pfx);
    expect(capture.options.agent.options.passphrase).toBe("senha");
  });
});

describe("conciliação do pagamento com o total da nota", () => {
  it("diferença de centavos no recálculo é absorvida pelo pagamento", () => {
    const ajustado = reconcilePayments([{ method: PaymentMethod.PIX_MANUAL, amountCents: 4999 }], 5000);

    expect(ajustado).toEqual([{ method: PaymentMethod.PIX_MANUAL, amountCents: 5000 }]);
  });

  it("sobra em dinheiro é troco e fica como está", () => {
    const pagamentos = [{ method: PaymentMethod.DINHEIRO, amountCents: 6000 }];

    expect(reconcilePayments(pagamentos, 5000)).toBe(pagamentos);
  });

  it("sobra no cartão é ajustada — cartão não devolve troco", () => {
    const ajustado = reconcilePayments([{ method: PaymentMethod.CARTAO_ENTREGA, amountCents: 6000 }], 5000);

    expect(ajustado[0].amountCents).toBe(5000);
  });

  it("ajuste que zeraria a última linha vira um pagamento único do total", () => {
    // Sem dinheiro em espécie não há troco possível, e o ajuste na última linha
    // a deixaria negativa: nesse caso o rateio anterior não descrevia a venda.
    const ajustado = reconcilePayments(
      [{ method: PaymentMethod.CARTAO_ENTREGA, amountCents: 3000 }, { method: PaymentMethod.PIX_MANUAL, amountCents: 3000 }],
      1000,
    );

    expect(ajustado).toEqual([{ method: PaymentMethod.CARTAO_ENTREGA, amountCents: 1000 }]);
  });
});
