#!/usr/bin/env node
/**
 * Remove exclusivamente a operação criada por setup-demo-company.js.
 *
 * A confirmação precisa ser o nome real do banco conectado. Sem ela, o script
 * apenas mostra a prévia e imprime o comando exato — nunca faz uma limpeza
 * global e nunca toca em outra empresa.
 *
 * Uso local:
 *   npm run demo:remove
 *
 * Produção, primeiro para conferir a prévia:
 *   node apps/api/prisma/remove-demo-company.js
 *
 * Depois, copie o comando exibido, acrescentando --allow-production:
 *   node apps/api/prisma/remove-demo-company.js --confirmar=NOME_DO_BANCO --allow-production
 */
require("dotenv").config({ quiet: true });

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const DEMO_SLUG = "operacao-demo-chegowia";
const DEMO_EMAIL_DOMAIN = "demo.chegowia.invalid";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [{ nome_do_banco: database }] = await prisma.$queryRawUnsafe("SELECT DATABASE() AS nome_do_banco");
  const confirmation = args.confirmar;
  const shouldExecute = confirmation === database;
  const production = process.env.NODE_ENV === "production";
  if (shouldExecute && production && !args["allow-production"]) {
    throw new Error("Produção exige --allow-production para remover a operação demo.");
  }

  const company = await prisma.company.findUnique({
    where: { slug: DEMO_SLUG },
    include: { subscription: { include: { commissions: { select: { id: true, status: true } } } } },
  });
  console.log(`\nBanco conectado: ${database}\n`);
  if (!company) {
    console.log("Nenhuma operação demo foi encontrada. Nada foi alterado.\n");
    return;
  }
  if (!company.isTestOnly) {
    throw new Error(
      `A empresa ${company.name} não está marcada como isTestOnly. Por segurança, ela não será apagada por este script.`,
    );
  }
  if (hasExternalBilling(company.subscription)) {
    throw new Error(
      "A operação demo possui cobrança, assinatura de provedor ou comissão vinculada. Nada foi apagado; revise essa situação antes de removê-la.",
    );
  }

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { companyId: company.id },
        { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
      ],
    },
    select: { id: true, email: true, companyId: true },
  });
  const misplacedDemoUser = users.find((user) => user.companyId && user.companyId !== company.id);
  if (misplacedDemoUser) {
    throw new Error(
      `A conta demo ${misplacedDemoUser.email} pertence a outra empresa. Nada foi apagado para evitar afetar dados fora da demo.`,
    );
  }
  const userIds = users.map((user) => user.id);
  await assertUsersAreIsolated(company.id, userIds);

  const counts = await countDemoData(company.id, userIds);
  console.log(`Empresa: ${company.name} (${company.slug})`);
  console.log("Serão removidos somente os dados abaixo:");
  for (const [label, count] of Object.entries(counts)) {
    if (count > 0) console.log(`  ${String(count).padStart(4)}  ${label}`);
  }
  console.log("");

  if (!shouldExecute) {
    if (confirmation) {
      console.log(`Nada foi apagado: "${confirmation}" não é o banco desta conexão ("${database}").\n`);
    } else {
      console.log("Nada foi apagado. Para executar depois de conferir a prévia:\n");
      console.log(`  node apps/api/prisma/remove-demo-company.js --confirmar=${database}${production ? " --allow-production" : ""}\n`);
    }
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Eventos fiscais sem documento (por exemplo, inutilização) não são filhos
    // de FiscalDocument; por isso a remoção é explícita antes da empresa.
    await tx.fiscalDocumentEvent.deleteMany({ where: { companyId: company.id } });
    await tx.fiscalDocument.deleteMany({ where: { companyId: company.id } });
    await tx.diningOrder.deleteMany({ where: { companyId: company.id } });
    await tx.tableSession.deleteMany({ where: { companyId: company.id } });
    await tx.cashSession.deleteMany({ where: { companyId: company.id } });
    await tx.cashRegister.deleteMany({ where: { companyId: company.id } });
    // Order faz cascade para itens, histórico, entrega e pagamento.
    await tx.order.deleteMany({ where: { companyId: company.id } });
    // Product aponta para Category com Restrict. A cascata da empresa não pode
    // escolher essa ordem por nós, então removemos o cardápio explicitamente.
    await tx.product.deleteMany({ where: { companyId: company.id } });
    await tx.category.deleteMany({ where: { companyId: company.id } });
    await tx.clientApplication.deleteMany({ where: { companyId: company.id } });
    if (company.subscription) {
      await tx.commissionLedger.deleteMany({ where: { subscriptionId: company.subscription.id } });
      await tx.clientSubscription.delete({ where: { id: company.subscription.id } });
    }
    if (userIds.length) {
      await tx.identityDocument.deleteMany({
        where: { ownerType: "USER", ownerId: { in: userIds } },
      });
    }
    await tx.identityDocument.deleteMany({ where: { ownerType: "COMPANY", ownerId: company.id } });
    // O restante dos dados que pertencem à empresa tem cascade no schema.
    await tx.company.delete({ where: { id: company.id } });
    if (userIds.length) await tx.user.deleteMany({ where: { id: { in: userIds } } });
  }, { timeout: 30_000 });

  console.log("Operação demo removida. Nenhuma outra empresa foi alterada.\n");
}

function hasExternalBilling(subscription) {
  if (!subscription) return false;
  return Boolean(
    subscription.commissions.length
    || subscription.stripeCustomerId
    || subscription.stripeSubscriptionId
    || subscription.stripeCheckoutSessionId
    || subscription.asaasCustomerId
    || subscription.asaasSubscriptionId
    || subscription.asaasPaymentId,
  );
}

async function assertUsersAreIsolated(companyId, userIds) {
  if (!userIds.length) return;
  const [
    foreignCustomerProfiles,
    foreignCustomerOrders,
    foreignDeliveries,
    foreignTableSessions,
    foreignDiningOrders,
    foreignOrderChanges,
    foreignAiConversations,
    foreignAiActions,
    foreignWhatsappConversations,
    foreignWhatsappMessages,
    resellerProfiles,
  ] = await Promise.all([
    prisma.customerProfile.count({ where: { userId: { in: userIds }, companyId: { not: companyId } } }),
    prisma.order.count({ where: { customerId: { in: userIds }, companyId: { not: companyId } } }),
    prisma.delivery.count({ where: { motoboyId: { in: userIds }, companyId: { not: companyId } } }),
    prisma.tableSession.count({
      where: {
        companyId: { not: companyId },
        OR: [
          { openedByUserId: { in: userIds } },
          { attendantUserId: { in: userIds } },
          { closedByUserId: { in: userIds } },
        ],
      },
    }),
    prisma.diningOrder.count({ where: { createdByUserId: { in: userIds }, companyId: { not: companyId } } }),
    prisma.orderStatusHistory.count({
      where: { changedByUserId: { in: userIds }, order: { companyId: { not: companyId } } },
    }),
    prisma.aIConversation.count({ where: { userId: { in: userIds }, companyId: { not: companyId } } }),
    prisma.aIActionLog.count({ where: { confirmedByUserId: { in: userIds }, companyId: { not: companyId } } }),
    prisma.whatsAppConversation.count({ where: { assignedToUserId: { in: userIds }, companyId: { not: companyId } } }),
    prisma.whatsAppMessage.count({ where: { sentByUserId: { in: userIds }, companyId: { not: companyId } } }),
    prisma.resellerProfile.count({ where: { userId: { in: userIds } } }),
  ]);
  const foreignRows = [
    ["perfil de cliente", foreignCustomerProfiles],
    ["pedido", foreignCustomerOrders],
    ["entrega", foreignDeliveries],
    ["comanda", foreignTableSessions],
    ["rodada de mesa", foreignDiningOrders],
    ["histórico de pedido", foreignOrderChanges],
    ["conversa de IA", foreignAiConversations],
    ["ação de IA", foreignAiActions],
    ["conversa de WhatsApp", foreignWhatsappConversations],
    ["mensagem de WhatsApp", foreignWhatsappMessages],
    ["perfil de revendedor", resellerProfiles],
  ].filter(([, count]) => count > 0);
  if (foreignRows.length) {
    const details = foreignRows.map(([label, count]) => `${count} ${label}(is)`).join(", ");
    throw new Error(`Há vínculos das contas demo fora desta empresa (${details}). Nada foi apagado.`);
  }
}

async function countDemoData(companyId, userIds) {
  const [
    categories,
    products,
    orders,
    deliveries,
    payments,
    tables,
    tableSessions,
    diningOrders,
    cashRegisters,
    cashSessions,
    customerProfiles,
    employeeProfiles,
    addresses,
    applications,
    fiscalDocuments,
    subscription,
  ] = await Promise.all([
    prisma.category.count({ where: { companyId } }),
    prisma.product.count({ where: { companyId } }),
    prisma.order.count({ where: { companyId } }),
    prisma.delivery.count({ where: { companyId } }),
    prisma.payment.count({ where: { companyId } }),
    prisma.restaurantTable.count({ where: { companyId } }),
    prisma.tableSession.count({ where: { companyId } }),
    prisma.diningOrder.count({ where: { companyId } }),
    prisma.cashRegister.count({ where: { companyId } }),
    prisma.cashSession.count({ where: { companyId } }),
    prisma.customerProfile.count({ where: { companyId } }),
    prisma.employeeProfile.count({ where: { companyId } }),
    userIds.length ? prisma.address.count({ where: { userId: { in: userIds } } }) : 0,
    prisma.clientApplication.count({ where: { companyId } }),
    prisma.fiscalDocument.count({ where: { companyId } }),
    prisma.clientSubscription.count({ where: { companyId } }),
  ]);
  return {
    "empresa demo": 1,
    "usuário(s) demo": userIds.length,
    "perfil(is) de funcionário": employeeProfiles,
    "perfil(is) de cliente": customerProfiles,
    "endereço(s) das contas demo": addresses,
    "categoria(s)": categories,
    "produto(s) e opções": products,
    "pedido(s)": orders,
    "entrega(s)": deliveries,
    "pagamento(s) interno(s)": payments,
    "mesa(s)": tables,
    "comanda(s)": tableSessions,
    "rodada(s) de mesa": diningOrders,
    "caixa(s)": cashRegisters,
    "turno(s) de caixa": cashSessions,
    "documento(s) fiscal(is) demo": fiscalDocuments,
    "candidatura(s) de cliente": applications,
    "assinatura demo sem provedor": subscription,
  };
}

function parseArgs(argv) {
  const result = {};
  for (const item of argv) {
    const flag = /^--([a-zA-Z][a-zA-Z-]*)$/.exec(item);
    if (flag) result[flag[1].toLowerCase()] = true;
    const value = /^--([a-zA-Z][a-zA-Z-]*)=([\s\S]*)$/.exec(item);
    if (value) result[value[1].toLowerCase()] = value[2];
  }
  return result;
}

main()
  .catch((error) => {
    console.error(`\nFalhou: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
