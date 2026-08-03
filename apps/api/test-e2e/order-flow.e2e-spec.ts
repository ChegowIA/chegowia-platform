import request from "supertest";
import { OrderStatus } from "@prisma/client";
import { Harness, createHarness } from "./harness";
import { CompanyFixture, createCompany, createCustomer } from "./fixtures";

/**
 * Caminho crítico do produto: o cliente monta o pedido, a loja o conduz até a
 * entrega. Cobre o que os testes unitários não alcançam — o preço recalculado
 * no servidor, a máquina de status e a persistência real.
 */
describe("pedido ponta a ponta (e2e)", () => {
  let harness: Harness;
  let loja: CompanyFixture;
  let cliente: Awaited<ReturnType<typeof createCustomer>>;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness?.close();
  });

  beforeEach(async () => {
    await harness.reset();
    loja = await createCompany(harness.prisma, "fluxo", { productName: "Pizza", productPrice: 40 });
    cliente = await createCustomer(harness.prisma, "fluxo");
  });

  function comoCliente(req: request.Test) {
    return req.set("Authorization", `Bearer ${harness.tokenFor(cliente as never)}`);
  }

  function comoLoja(req: request.Test) {
    return req.set("Authorization", `Bearer ${harness.tokenFor(loja.admin)}`);
  }

  async function criarPedido(quantidade = 2) {
    const resposta = await comoCliente(
      request(harness.app.getHttpServer()).post("/api/me/orders"),
    ).send({
      companySlug: loja.slug,
      addressId: cliente.addressId,
      paymentMethod: "DINHEIRO",
      items: [{ productId: loja.productId, quantity: quantidade }],
    });
    return resposta;
  }

  it("cria o pedido e calcula o valor no servidor", async () => {
    const resposta = await criarPedido(2);

    expect(resposta.status).toBe(201);
    expect(Number(resposta.body.subtotal)).toBe(80);
    expect(resposta.body.status).toBe(OrderStatus.RECEBIDO);

    const salvo = await harness.prisma.order.findUnique({
      where: { id: resposta.body.id },
      include: { items: true },
    });
    expect(salvo?.companyId).toBe(loja.id);
    expect(salvo?.items).toHaveLength(1);
    expect(Number(salvo?.items[0].unitPrice)).toBe(40);
  });

  it("ignora preço enviado pelo cliente — o DTO não aceita o campo", async () => {
    const resposta = await comoCliente(
      request(harness.app.getHttpServer()).post("/api/me/orders"),
    ).send({
      companySlug: loja.slug,
      addressId: cliente.addressId,
      paymentMethod: "DINHEIRO",
      total: 1,
      items: [{ productId: loja.productId, quantity: 1, unitPrice: 1 }],
    });

    expect(resposta.status).toBe(400);
  });

  it("percorre a máquina de status até a entrega", async () => {
    const criado = await criarPedido(1);
    const id = criado.body.id;

    for (const status of [
      OrderStatus.CONFIRMADO,
      OrderStatus.EM_PREPARO,
      OrderStatus.PRONTO,
      OrderStatus.SAIU_PARA_ENTREGA,
      OrderStatus.ENTREGUE,
    ]) {
      await comoLoja(request(harness.app.getHttpServer()).patch(`/api/orders/${id}/status`))
        .send({ status })
        .expect(200);
    }

    const final = await harness.prisma.order.findUnique({
      where: { id },
      include: { statusHistory: true },
    });
    expect(final?.status).toBe(OrderStatus.ENTREGUE);
    expect(final!.statusHistory.length).toBeGreaterThanOrEqual(5);
  });

  it("pular etapa é recusado", async () => {
    const criado = await criarPedido(1);

    const resposta = await comoLoja(
      request(harness.app.getHttpServer()).patch(`/api/orders/${criado.body.id}/status`),
    ).send({ status: OrderStatus.ENTREGUE });

    expect(resposta.status).toBe(400);
    const salvo = await harness.prisma.order.findUnique({ where: { id: criado.body.id } });
    expect(salvo?.status).toBe(OrderStatus.RECEBIDO);
  });

  it("estado terminal não volta atrás", async () => {
    const criado = await criarPedido(1);
    const id = criado.body.id;
    await comoLoja(request(harness.app.getHttpServer()).patch(`/api/orders/${id}/status`))
      .send({ status: OrderStatus.CANCELADO })
      .expect(200);

    const resposta = await comoLoja(
      request(harness.app.getHttpServer()).patch(`/api/orders/${id}/status`),
    ).send({ status: OrderStatus.CONFIRMADO });

    expect(resposta.status).toBe(400);
  });

  it("o cliente vê o próprio pedido e não o de outro", async () => {
    const criado = await criarPedido(1);
    const outro = await createCustomer(harness.prisma, "intruso");

    await comoCliente(request(harness.app.getHttpServer()).get(`/api/me/orders/${criado.body.id}`))
      .expect(200);

    const resposta = await request(harness.app.getHttpServer())
      .get(`/api/me/orders/${criado.body.id}`)
      .set("Authorization", `Bearer ${harness.tokenFor(outro as never)}`);

    expect(resposta.status).toBeGreaterThanOrEqual(400);
  });
});
