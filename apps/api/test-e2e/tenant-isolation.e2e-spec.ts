import request from "supertest";
import { OrderStatus } from "@prisma/client";
import { Harness, createHarness } from "./harness";
import { CompanyFixture, createCompany, createCustomer } from "./fixtures";

/**
 * Isolamento multiempresa ponta a ponta.
 *
 * Os testes unitários mockam o Prisma, então não conseguem provar isolamento:
 * a extensão de tenant é justamente o que o mock substitui. Foi assim que
 * `/reports/top-products` passou meses devolvendo os campeões de venda de
 * *todas* as empresas — `OrderItem` não tem `companyId` e a extensão não
 * reescreve filtro de relação. Este arquivo existe para que uma regressão
 * dessas apareça no CI.
 */
describe("isolamento multiempresa (e2e)", () => {
  let harness: Harness;
  let alfa: CompanyFixture;
  let beta: CompanyFixture;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness?.close();
  });

  beforeEach(async () => {
    await harness.reset();
    alfa = await createCompany(harness.prisma, "alfa", { productName: "Pizza Alfa", productPrice: 40 });
    beta = await createCompany(harness.prisma, "beta", { productName: "Pizza Beta", productPrice: 60 });
  });

  async function criarPedido(empresa: CompanyFixture, seed: string) {
    const cliente = await createCustomer(harness.prisma, `${seed}-${empresa.slug}`);
    return harness.prisma.order.create({
      data: {
        companyId: empresa.id,
        customerId: cliente.id,
        addressId: cliente.addressId,
        status: OrderStatus.RECEBIDO,
        paymentMethod: "DINHEIRO",
        subtotal: empresa.productPrice,
        deliveryFee: 5,
        total: empresa.productPrice + 5,
        deliveryStreet: "Rua das Flores",
        deliveryNumber: "100",
        deliveryNeighborhood: "Centro",
        deliveryCity: "Belo Horizonte",
        deliveryState: "MG",
        items: {
          create: [{
            productId: empresa.productId,
            productName: `Produto ${empresa.slug}`,
            quantity: 1,
            unitPrice: empresa.productPrice,
            totalPrice: empresa.productPrice,
          }],
        },
      },
    });
  }

  it("a listagem de pedidos mostra só a própria empresa", async () => {
    await criarPedido(alfa, "p1");
    await criarPedido(beta, "p1");

    const resposta = await request(harness.app.getHttpServer())
      .get("/api/orders")
      .set("Authorization", `Bearer ${harness.tokenFor(alfa.admin)}`)
      .expect(200);

    const pedidos = Array.isArray(resposta.body) ? resposta.body : resposta.body.items;
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].companyId).toBe(alfa.id);
  });

  it("buscar pelo id um pedido de outra empresa não devolve o pedido", async () => {
    const pedidoBeta = await criarPedido(beta, "p2");

    const resposta = await request(harness.app.getHttpServer())
      .get(`/api/orders/${pedidoBeta.id}`)
      .set("Authorization", `Bearer ${harness.tokenFor(alfa.admin)}`);

    expect(resposta.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(resposta.body)).not.toContain(beta.id);
  });

  it("mais vendidos não vaza produto de outra empresa", async () => {
    // A regressão real: OrderItem não tem companyId e o agrupamento acontecia
    // sem escopo, então o campeão de venda da concorrente aparecia aqui.
    await criarPedido(beta, "p3");
    await criarPedido(beta, "p4");
    await criarPedido(alfa, "p3");

    const resposta = await request(harness.app.getHttpServer())
      .get("/api/reports/top-products")
      .set("Authorization", `Bearer ${harness.tokenFor(alfa.admin)}`)
      .expect(200);

    const corpo = JSON.stringify(resposta.body);
    expect(corpo).not.toContain("beta");
    expect(corpo).toContain("alfa");
  });

  it("faturamento não soma pedidos de outra empresa", async () => {
    await criarPedido(alfa, "p5");
    await criarPedido(beta, "p5");
    await criarPedido(beta, "p6");

    const resposta = await request(harness.app.getHttpServer())
      .get("/api/reports/sales")
      .set("Authorization", `Bearer ${harness.tokenFor(alfa.admin)}`)
      .expect(200);

    const total = resposta.body.totalRevenue ?? resposta.body.total ?? resposta.body.revenue;
    expect(Number(total)).toBe(alfa.productPrice + 5);
  });

  it("alterar status de pedido alheio é recusado e não muda nada", async () => {
    const pedidoBeta = await criarPedido(beta, "p7");

    const resposta = await request(harness.app.getHttpServer())
      .patch(`/api/orders/${pedidoBeta.id}/status`)
      .set("Authorization", `Bearer ${harness.tokenFor(alfa.admin)}`)
      .send({ status: OrderStatus.CONFIRMADO });

    expect(resposta.status).toBeGreaterThanOrEqual(400);
    const depois = await harness.prisma.order.findUnique({ where: { id: pedidoBeta.id } });
    expect(depois?.status).toBe(OrderStatus.RECEBIDO);
  });

  it("sem token não passa", async () => {
    await request(harness.app.getHttpServer()).get("/api/orders").expect(401);
  });
});
