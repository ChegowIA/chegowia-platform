import { brazilianMobileDestination } from "../src/messaging/providers/gupshup-whatsapp.provider";

/**
 * O webhook entrega o `wa_id` de celulares brasileiros antigos sem o nono
 * dígito. A v1 do Gupshup aceita essa forma, responde "submitted" e nunca
 * entrega — falha silenciosa que só se manifesta como mensagem que não chega.
 * Estes testes fixam a conversão e, principalmente, os casos em que ela NÃO deve
 * acontecer.
 */
describe("destino de celular brasileiro no Gupshup", () => {
  it("acrescenta o nono dígito no celular legado de oito dígitos", () => {
    // Caso real observado em produção: (62) 98625-1491 chegou sem o 9.
    expect(brazilianMobileDestination("556286251491")).toBe("5562986251491");
  });

  it("preserva o número que já tem o nono dígito", () => {
    expect(brazilianMobileDestination("5562986251491")).toBe("5562986251491");
  });

  it.each(["556231425344", "551132145678", "556225551234"])(
    "não mexe em fixo brasileiro (%s), que também tem oito dígitos",
    (phone) => {
      // Fixos começam em 2–5; inserir o 9 criaria um número inexistente.
      expect(brazilianMobileDestination(phone)).toBe(phone);
    },
  );

  it.each(["12125551234", "351912345678", "5491123456789"])(
    "não mexe em número estrangeiro (%s)",
    (phone) => {
      expect(brazilianMobileDestination(phone)).toBe(phone);
    },
  );

  it("não mexe em número curto ou malformado", () => {
    expect(brazilianMobileDestination("5562")).toBe("5562");
    expect(brazilianMobileDestination("")).toBe("");
  });
});
