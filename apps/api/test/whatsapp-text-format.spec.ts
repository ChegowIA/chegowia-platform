import { formatForWhatsapp } from "../src/messaging/whatsapp-text-format";

/**
 * O modelo escreve em Markdown, o WhatsApp usa outra convenção. Estes testes
 * partem dos casos observados em produção: asteriscos duplos aparecendo
 * literalmente e, principalmente, colando em URLs e impedindo o aplicativo de
 * reconhecer o link.
 */
describe("formatação de texto para o WhatsApp", () => {
  it("converte negrito de Markdown para o asterisco único do WhatsApp", () => {
    expect(formatForWhatsapp("**Mas atenção:** os **assistentes de IA**")).toBe(
      "*Mas atenção:* os *assistentes de IA*",
    );
  });

  it("solta a URL que estava envolvida por asteriscos, que quebrava o link", () => {
    // Caso real: o WhatsApp não linkava porque o asterisco colava no endereço.
    expect(formatForWhatsapp("É só entrar em **https://chegowia.com.br/planos**, escolher")).toBe(
      "É só entrar em https://chegowia.com.br/planos, escolher",
    );
  });

  it("troca o travessão longo por hífen", () => {
    expect(formatForWhatsapp("paga pouco — e se não usar IA, não tem custo")).toBe(
      "paga pouco - e se não usar IA, não tem custo",
    );
  });

  it("transforma link de Markdown em rótulo mais URL", () => {
    expect(formatForWhatsapp("Veja os [nossos planos](https://chegowia.com.br/planos) hoje")).toBe(
      "Veja os nossos planos: https://chegowia.com.br/planos hoje",
    );
  });

  it("descarta o rótulo quando ele repete a própria URL", () => {
    expect(formatForWhatsapp("[https://chegowia.com.br](https://chegowia.com.br)")).toBe(
      "https://chegowia.com.br",
    );
  });

  it("converte título de Markdown em negrito", () => {
    expect(formatForWhatsapp("## Planos disponíveis\ntexto")).toBe("*Planos disponíveis*\ntexto");
  });

  it("usa marcador de lista legível no aplicativo", () => {
    expect(formatForWhatsapp("- primeiro\n- segundo")).toBe("• primeiro\n• segundo");
  });

  it("converte negrito com itálico combinados", () => {
    expect(formatForWhatsapp("***muito importante***")).toBe("*_muito importante_*");
  });

  it("não estraga underscore dentro de URL nem de identificador", () => {
    const text = "veja https://exemplo.com/a_b_c e o campo nome_do_campo aqui";
    expect(formatForWhatsapp(text)).toBe(text);
  });

  it("colapsa linhas em branco excedentes e apara espaço no fim das linhas", () => {
    expect(formatForWhatsapp("um   \n\n\n\ndois")).toBe("um\n\ndois");
  });

  it("preserva emoji, que é parte do tom das mensagens", () => {
    expect(formatForWhatsapp("Oi! 😊 Tudo bem?")).toBe("Oi! 😊 Tudo bem?");
  });

  it("remove o rótulo de linguagem do bloco de código", () => {
    expect(formatForWhatsapp("```json\n{}\n```")).toBe("```\n{}\n```");
  });

  it("corta no limite do WhatsApp", () => {
    expect(formatForWhatsapp("a".repeat(5000))).toHaveLength(4096);
  });
});
