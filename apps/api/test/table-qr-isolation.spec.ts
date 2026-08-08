import { DiningOrderSource, DiningOrderStatus, PaymentMethod, TableStatus } from "@prisma/client";
import { TablesService } from "../src/tables/tables.service";

/**
 * O token do QR é a única entrada pública. Estes testes asseguram que ele é
 * resolvido no servidor e que nenhum companyId/tableId enviado pelo navegador
 * participa da decisão de onde a comanda ou a rodada será criada.
 */
describe("QR público de mesa: isolamento e vínculo", () => {
  const realtime = { emitToCompany: jest.fn() };
  const publicTable = {
    id: "mesa-empresa-a",
    companyId: "empresa-a",
    status: TableStatus.OCUPADA,
    name: "Mesa 12",
    seats: 4,
    area: "Salão",
    company: { id: "empresa-a", name: "Empresa A", logoUrl: null, isActive: true },
  };

  beforeEach(() => jest.clearAllMocks());

  it("cria a rodada somente na sessão e empresa resolvidas pelo token", async () => {
    let createArgs: any;
    const prisma = {
      restaurantTable: { findUnique: jest.fn().mockResolvedValue(publicTable) },
      tableSession: { findFirst: jest.fn().mockResolvedValue({ id: "sessao-mesa-a" }) },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { id: "produto-a", companyId: "empresa-a", name: "Prato A", price: 24, variations: [], addons: [] },
        ]),
      },
      $transaction: jest.fn().mockImplementation((fn: any) => fn({
        tableSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        diningOrder: {
          create: jest.fn().mockImplementation((args: any) => {
            createArgs = args;
            return Promise.resolve({
              id: "rodada-qr-a",
              status: DiningOrderStatus.RECEBIDO,
              subtotal: args.data.subtotal,
              items: args.data.items.create,
            });
          }),
        },
      })),
    };
    const service = new TablesService(prisma as never, realtime as never);

    await service.addOrderFromQr("token-publico-seguro-da-mesa-a", {
      items: [{ productId: "produto-a", quantity: 2 }],
    } as any);

    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId: "empresa-a" }),
    }));
    expect(createArgs.data).toMatchObject({
      companyId: "empresa-a",
      tableSessionId: "sessao-mesa-a",
      createdByUserId: null,
      source: DiningOrderSource.QR_MESA,
    });
    expect(realtime.emitToCompany).toHaveBeenCalledWith("empresa-a", "table.order_created", expect.objectContaining({
      tableId: "mesa-empresa-a",
    }));
  });

  it("recusa produto que não pertence à empresa da mesa, mesmo com token válido", async () => {
    const prisma = {
      restaurantTable: { findUnique: jest.fn().mockResolvedValue(publicTable) },
      tableSession: { findFirst: jest.fn().mockResolvedValue({ id: "sessao-mesa-a" }) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new TablesService(prisma as never, realtime as never);

    await expect(service.addOrderFromQr("token-publico-seguro-da-mesa-a", {
      items: [{ productId: "produto-da-empresa-b", quantity: 1 }],
    } as any)).rejects.toThrow(/indisponível/i);
    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId: "empresa-a" }),
    }));
  });

  it("abre uma comanda do QR com empresa e mesa fixadas no token", async () => {
    let claimArgs: any;
    let sessionArgs: any;
    const freeTable = { ...publicTable, status: TableStatus.LIVRE };
    const prisma = {
      restaurantTable: { findUnique: jest.fn().mockResolvedValue(freeTable) },
      tableSession: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((fn: any) => fn({
        restaurantTable: {
          updateMany: jest.fn().mockImplementation((args: any) => {
            claimArgs = args;
            return Promise.resolve({ count: 1 });
          }),
        },
        tableSession: {
          create: jest.fn().mockImplementation((args: any) => {
            sessionArgs = args;
            return Promise.resolve({ guestCount: 3, openedAt: new Date(), attendantUserId: null });
          }),
        },
      })),
    };
    const service = new TablesService(prisma as never, realtime as never);

    await service.openFromQr("token-publico-seguro-da-mesa-a", { guestCount: 3, customerName: "Cliente" } as any);

    expect(claimArgs.where).toMatchObject({ id: "mesa-empresa-a", companyId: "empresa-a" });
    expect(sessionArgs.data).toMatchObject({
      companyId: "empresa-a",
      tableId: "mesa-empresa-a",
      openedByUserId: null,
      attendantUserId: null,
      openedFromQr: true,
    });
  });

  it("não deixa outro usuário fechar a mesa assumida por quem a atende", async () => {
    const prisma = {
      tableSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: "sessao-mesa-a",
          attendantUserId: "garcom-responsavel",
          orders: [],
        }),
      },
    };
    const service = new TablesService(prisma as never, realtime as never);

    await expect(service.close("mesa-empresa-a", "garcom-sem-atendimento", "empresa-a", { paymentMethod: PaymentMethod.DINHEIRO }))
      .rejects.toThrow(/assumiu este atendimento/i);
  });

  it("registra o recebimento e agenda a NFC-e ao fechar uma mesa com emissão automática", async () => {
    let closeData: any;
    const fiscal = { emitForTableSession: jest.fn().mockResolvedValue({ id: "nota-mesa-a" }) };
    const closedSession = {
      id: "sessao-mesa-a",
      attendantUserId: "garcom-responsavel",
      customerDocument: null,
      orders: [],
    };
    const prisma = {
      tableSession: {
        findFirst: jest.fn().mockResolvedValue(closedSession),
      },
      companyFiscalProfile: {
        findUnique: jest.fn().mockResolvedValue({ autoEmit: true }),
      },
      $transaction: jest.fn().mockImplementation((fn: any) => fn({
        tableSession: {
          updateMany: jest.fn().mockImplementation((args: any) => {
            closeData = args.data;
            return Promise.resolve({ count: 1 });
          }),
          findFirst: jest.fn().mockResolvedValue(closedSession),
        },
        restaurantTable: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      })),
    };
    const service = new TablesService(prisma as never, realtime as never, fiscal as never);

    const result: any = await service.close("mesa-empresa-a", "garcom-responsavel", "empresa-a", {
      paymentMethod: PaymentMethod.PIX_MANUAL,
      customerDocument: "12345678901",
    });

    expect(closeData).toMatchObject({
      paymentMethod: PaymentMethod.PIX_MANUAL,
      customerDocument: "12345678901",
      closedByUserId: "garcom-responsavel",
    });
    expect(fiscal.emitForTableSession).toHaveBeenCalledWith("empresa-a", "sessao-mesa-a");
    expect(result.fiscal).toEqual({ automaticFiscalEmission: true });
    expect(realtime.emitToCompany).toHaveBeenCalledWith("empresa-a", "table.closed", expect.objectContaining({
      tableId: "mesa-empresa-a",
      automaticFiscalEmission: true,
    }));
  });

  it("não cria pedido se a comanda fechar antes de a rodada obter o lock", async () => {
    const create = jest.fn();
    const prisma = {
      restaurantTable: { findUnique: jest.fn().mockResolvedValue(publicTable) },
      tableSession: { findFirst: jest.fn().mockResolvedValue({ id: "sessao-mesa-a" }) },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { id: "produto-a", companyId: "empresa-a", name: "Prato A", price: 24, variations: [], addons: [] },
        ]),
      },
      $transaction: jest.fn().mockImplementation((fn: any) => fn({
        tableSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        diningOrder: { create },
      })),
    };
    const service = new TablesService(prisma as never, realtime as never);

    await expect(service.addOrderFromQr("token-publico-seguro-da-mesa-a", {
      items: [{ productId: "produto-a", quantity: 1 }],
    } as any)).rejects.toThrow(/comanda foi fechada/i);
    expect(create).not.toHaveBeenCalled();
  });

  it("não entrega o token do QR de uma mesa de outra empresa", async () => {
    const prisma = {
      restaurantTable: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new TablesService(prisma as never, realtime as never);

    await expect(service.getQrToken("mesa-empresa-b", "empresa-a"))
      .rejects.toThrow(/mesa não encontrada/i);
    expect(prisma.restaurantTable.findFirst).toHaveBeenCalledWith({
      where: { id: "mesa-empresa-b", companyId: "empresa-a" },
    });
  });
});
