import {
  formatarTelefoneParaExibicao,
  lerListaDeContatos,
  normalizarTelefoneBrasileiro,
  pareceTelefoneFixo,
  pediuParaNaoReceber,
  renderizarModelo,
} from "../src/messaging/outreach-contacts";

/**
 * A lista colada é a única entrada do disparo, e um dígito lido errado manda
 * oferta comercial para um desconhecido — o que derruba a reputação do número
 * institucional junto com o suporte, que usa o mesmo. Então o que não fecha em
 * telefone brasileiro válido tem de voltar recusado, não ser adivinhado.
 */
describe("leitura da lista de contatos", () => {
  it("normaliza os formatos que as pessoas escrevem", () => {
    const esperado = "5562999998888";
    expect(normalizarTelefoneBrasileiro("(62) 99999-8888")).toBe(esperado);
    expect(normalizarTelefoneBrasileiro("62 99999 8888")).toBe(esperado);
    expect(normalizarTelefoneBrasileiro("+55 62 99999-8888")).toBe(esperado);
    expect(normalizarTelefoneBrasileiro("5562999998888")).toBe(esperado);
    expect(normalizarTelefoneBrasileiro("62999998888")).toBe(esperado);
  });

  it("recusa o que não é telefone brasileiro", () => {
    // DDD que não existe passaria a mensagem para sabe-se lá quem.
    expect(normalizarTelefoneBrasileiro("(00) 99999-8888")).toBeNull();
    expect(normalizarTelefoneBrasileiro("(01) 99999-8888")).toBeNull();
    expect(normalizarTelefoneBrasileiro("999998888")).toBeNull();
    expect(normalizarTelefoneBrasileiro("62 19999-8888")).toBeNull();
    expect(normalizarTelefoneBrasileiro("62999998888999")).toBeNull();
    expect(normalizarTelefoneBrasileiro("não tenho")).toBeNull();
  });

  it("aceita a numeração antiga de oito dígitos", () => {
    expect(normalizarTelefoneBrasileiro("(62) 8888-7777")).toBe("556288887777");
  });

  it("separa nome e cidade do telefone", () => {
    const { contatos } = lerListaDeContatos("Pizzaria do Zé - Goiânia - (62) 99999-8888");
    expect(contatos).toEqual([{ phone: "5562999998888", name: "Pizzaria do Zé", city: "Goiânia" }]);
  });

  it("ignora rótulos como Tel e WhatsApp", () => {
    const { contatos } = lerListaDeContatos("Bar do João | WhatsApp: 62 98888-7777");
    expect(contatos[0]).toEqual({ phone: "5562988887777", name: "Bar do João", city: null });
  });

  it("lê uma coluna de planilha sem nome", () => {
    const { contatos, recusados } = lerListaDeContatos("62999998888\n11988887777\n(21) 97777-6666");
    expect(contatos.map((contato) => contato.phone)).toEqual(["5562999998888", "5511988887777", "5521977776666"]);
    expect(recusados).toHaveLength(0);
  });

  it("mais de um número na mesma linha fica com o mesmo rótulo", () => {
    const { contatos } = lerListaDeContatos("Padaria Central: 62 3333-4444 / 62 99999-1234");
    expect(contatos).toHaveLength(2);
    expect(contatos.every((contato) => contato.name === "Padaria Central")).toBe(true);
  });

  it("separa números colados só por espaço", () => {
    const { contatos } = lerListaDeContatos("62999998888 62988887777");
    expect(contatos.map((contato) => contato.phone)).toEqual(["5562999998888", "5562988887777"]);
  });

  it("conta repetição em vez de mandar duas vezes", () => {
    const { contatos, repetidos } = lerListaDeContatos("62 99999-8888\n(62) 99999-8888\n+5562999998888");
    expect(contatos).toHaveLength(1);
    expect(repetidos).toBe(2);
  });

  it("devolve o trecho recusado com o motivo, para conferência", () => {
    const { contatos, recusados } = lerListaDeContatos("Fulano - sem telefone\n62 99999-8888\n(00) 12345-6789");
    expect(contatos).toHaveLength(1);
    expect(recusados).toEqual([
      { texto: "Fulano - sem telefone", motivo: "linha sem telefone" },
      { texto: "(00) 12345-6789", motivo: "número fora de um formato brasileiro válido" },
    ]);
  });

  it("sinaliza telefone fixo, que quase nunca tem WhatsApp", () => {
    const { possiveisFixos } = lerListaDeContatos("Restaurante - 62 3212-4545");
    expect(possiveisFixos).toEqual(["556232124545"]);
    expect(pareceTelefoneFixo("5562999998888")).toBe(false);
  });

  it("linha vazia não vira recusa", () => {
    const { contatos, recusados } = lerListaDeContatos("\n\n62999998888\n   \n");
    expect(contatos).toHaveLength(1);
    expect(recusados).toHaveLength(0);
  });

  it("mostra o número no formato que o brasileiro lê", () => {
    expect(formatarTelefoneParaExibicao("5562999998888")).toBe("(62) 99999-8888");
    expect(formatarTelefoneParaExibicao("556232124545")).toBe("(62) 3212-4545");
  });
});

describe("pedido de não receber mais", () => {
  it("reconhece as formas usuais de pedir para sair", () => {
    for (const texto of [
      "me tira dessa lista",
      "Me remova por favor",
      "não quero receber mensagens",
      "nao quero mais receber isso",
      "pare de me mandar mensagem",
      "para de mandar",
      "não me manda mais nada",
      "descadastrar",
      "nunca mais me chame aqui",
      "STOP",
    ]) {
      expect(pediuParaNaoReceber(texto)).toBe(true);
    }
  });

  it("um não para a oferta não é pedido de bloqueio", () => {
    // Quem já conversou nunca volta para uma lista de prospecção, então tratar
    // isso como bloqueio permanente só perderia o contato de um lead morno.
    for (const texto of [
      "não tenho interesse agora",
      "quanto custa?",
      "não quero o plano mais caro",
      "vou pensar e te falo",
      "",
    ]) {
      expect(pediuParaNaoReceber(texto)).toBe(false);
    }
  });
});

describe("texto do modelo guardado no histórico", () => {
  it("preenche as variáveis na ordem", () => {
    expect(renderizarModelo("Oi {{1}}, aqui é da ChegowIA em {{2}}.", ["Zé", "Goiânia"]))
      .toBe("Oi Zé, aqui é da ChegowIA em Goiânia.");
  });

  it("variável sem valor fica visível em vez de virar vazio", () => {
    // Some no texto seria pior: ninguém descobriria que o modelo tem uma
    // variável a mais do que o disparo preenche.
    expect(renderizarModelo("Oi {{1}}, tudo bem {{2}}?", ["Zé"])).toBe("Oi Zé, tudo bem {{2}}?");
  });

  it("sem corpo cadastrado não inventa texto", () => {
    expect(renderizarModelo(null, ["Zé"])).toBeNull();
  });
});
