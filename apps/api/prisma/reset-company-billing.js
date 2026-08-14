/**
 * Zera a cobrança de uma empresa para refazer o fluxo do zero.
 *
 * Feito para validar o ciclo real em produção: apaga o consumo registrado,
 * encerra a assinatura no Asaas com as cobranças em aberto, e devolve a
 * assinatura da plataforma ao estado de "teste terminado" — o mesmo em que o
 * empresário vê o botão de gerar a fatura de ativação.
 *
 * É destrutivo e não tem volta, então exige --confirmar e não tem e-mail padrão.
 * Nada de dinheiro é desfeito: cobrança paga não é apagada, e comissão lançada é
 * apenas reportada. Se houver, resolva no painel do Asaas.
 *
 * Em JavaScript puro pelo mesmo motivo do create-super-admin.js: a imagem de
 * produção não tem ts-node nem o package.json do apps/api.
 *
 * Uso no shell do Render:
 *   node apps/api/prisma/reset-company-billing.js --email=dono@empresa.com
 *   node apps/api/prisma/reset-company-billing.js --email=dono@empresa.com --confirmar
 *   node apps/api/prisma/reset-company-billing.js --email=... --confirmar --mensalidade=5
 *
 * Sem --confirmar ele só mostra o que faria.
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function arg(nome) {
  const encontrado = process.argv.find((item) => item.startsWith(`--${nome}=`));
  return encontrado ? encontrado.slice(nome.length + 3) : null;
}

function asaasBaseUrl(chave) {
  const configurada = process.env.ASAAS_API_BASE_URL?.trim();
  if (configurada) return configurada.replace(/\/$/, "");
  return chave.startsWith("$aact_prod_") ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
}

async function asaas(caminho, init = {}) {
  const chave = process.env.ASAAS_API_KEY?.trim();
  if (!chave) throw new Error("ASAAS_API_KEY não está definida neste ambiente.");
  const resposta = await fetch(`${asaasBaseUrl(chave)}${caminho}`, {
    method: init.method ?? "GET",
    headers: { access_token: chave, "Content-Type": "application/json", "User-Agent": "ChegowIA" },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  if (resposta.status === 404) return null;
  const texto = await resposta.text();
  let corpo = null;
  try { corpo = texto ? JSON.parse(texto) : null; } catch { corpo = null; }
  if (!resposta.ok || (Array.isArray(corpo?.errors) && corpo.errors.length)) {
    const detalhe = Array.isArray(corpo?.errors)
      ? corpo.errors.map((item) => item.description).filter(Boolean).join("; ")
      : texto.slice(0, 300);
    throw new Error(`Asaas recusou ${init.method ?? "GET"} ${caminho}: ${detalhe}`);
  }
  return corpo;
}

function reais(valor) {
  return `R$ ${Number(valor).toFixed(2).replace(".", ",")}`;
}

const PAGAS = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];

async function main() {
  const email = arg("email");
  const confirmar = process.argv.includes("--confirmar");
  const mensalidade = arg("mensalidade");
  if (!email) throw new Error("Informe --email=dono@empresa.com (não há padrão, de propósito).");

  const usuario = await prisma.user.findFirst({
    where: { email, companyId: { not: null } },
    select: { companyId: true, company: { select: { name: true } } },
  });
  if (!usuario?.companyId) throw new Error(`Nenhuma empresa vinculada ao e-mail ${email}.`);
  const companyId = usuario.companyId;

  const assinatura = await prisma.clientSubscription.findUnique({
    where: { companyId },
    include: { plan: { select: { name: true, monthlyPrice: true } } },
  });
  if (!assinatura) throw new Error(`A empresa ${usuario.company?.name} não tem assinatura.`);

  const consumo = await prisma.usageLedger.count({ where: { companyId } });
  const comissoes = await prisma.commissionLedger.count({ where: { subscriptionId: assinatura.id } });

  console.log(`Empresa: ${usuario.company?.name} (${companyId})`);
  console.log(`Assinatura: ${assinatura.status} · plano ${assinatura.plan.name} · ${reais(assinatura.plan.monthlyPrice)}`);
  console.log(`Consumo registrado: ${consumo} lançamento(s)`);
  console.log(`Assinatura no Asaas: ${assinatura.asaasSubscriptionId ?? "nenhuma"}`);
  console.log(`Cliente no Asaas: ${assinatura.asaasCustomerId ?? "nenhum"} (preservado)`);
  if (comissoes) {
    console.log(`\nATENÇÃO: ${comissoes} lançamento(s) de comissão nesta assinatura NÃO serão apagados.`);
    console.log("Comissão é dinheiro devido a alguém; resolva pelo painel se precisar.");
  }

  if (!confirmar) {
    console.log("\nNada foi alterado. Rode de novo com --confirmar para executar:");
    console.log("  1. apagar todo o consumo registrado da empresa");
    console.log("  2. encerrar a assinatura no Asaas e apagar as cobranças em aberto");
    console.log("  3. devolver a assinatura ao estado de teste terminado");
    return;
  }

  // 1. Cobranças em aberto no Asaas. Paga não é apagada: dinheiro que entrou não
  // se desfaz por script.
  if (assinatura.asaasCustomerId) {
    const lista = await asaas(`/payments?customer=${encodeURIComponent(assinatura.asaasCustomerId)}&limit=100`);
    const cobrancas = lista?.data ?? [];
    const pagas = cobrancas.filter((item) => PAGAS.includes(item.status));
    const abertas = cobrancas.filter((item) => !PAGAS.includes(item.status) && !item.deleted);
    for (const cobranca of abertas) {
      await asaas(`/payments/${encodeURIComponent(cobranca.id)}`, { method: "DELETE" });
      console.log(`\nCobrança ${cobranca.id} de ${reais(cobranca.value)} apagada no Asaas.`);
    }
    if (!abertas.length) console.log("\nNenhuma cobrança em aberto para apagar.");
    if (pagas.length) {
      console.log(`${pagas.length} cobrança(s) paga(s) mantida(s): ${pagas.map((item) => item.id).join(", ")}`);
    }
  }

  // 2. Assinatura no Asaas.
  if (assinatura.asaasSubscriptionId) {
    await asaas(`/subscriptions/${encodeURIComponent(assinatura.asaasSubscriptionId)}`, { method: "DELETE" });
    console.log(`Assinatura ${assinatura.asaasSubscriptionId} encerrada no Asaas.`);
  }

  // 3. Consumo registrado.
  const removidos = await prisma.usageLedger.deleteMany({ where: { companyId } });
  console.log(`${removidos.count} lançamento(s) de consumo apagado(s).`);

  // 4. Assinatura da plataforma volta ao estado de teste terminado, que é onde o
  // empresário vê o botão de gerar a fatura de ativação.
  const agora = new Date();
  const inicioDoTeste = new Date(agora.getTime() - 8 * 24 * 60 * 60 * 1000);
  const fimDoTeste = new Date(agora.getTime() - 60_000);
  await prisma.clientSubscription.update({
    where: { id: assinatura.id },
    data: {
      status: "EM_TESTE",
      trialStartedAt: inicioDoTeste,
      trialEndsAt: fimDoTeste,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      asaasPeriodPaymentId: null,
      canceledAt: null,
      discountEndsAt: null,
      asaasSubscriptionId: null,
      asaasPaymentId: null,
      ...(mensalidade ? { monthlyPriceSnapshot: Number(mensalidade) } : {}),
    },
  });
  console.log(`Assinatura devolvida a EM_TESTE com teste encerrado em ${fimDoTeste.toLocaleString("pt-BR")}.`);
  if (mensalidade) console.log(`Mensalidade de teste ajustada para ${reais(mensalidade)}.`);

  console.log("\nPróximos passos:");
  console.log("  1. Em /painel/assinatura, clique em \"Gerar fatura e liberar tudo\".");
  console.log("  2. Para ver consumo somado na fatura, lance antes:");
  console.log(`     node apps/api/prisma/simulate-usage-charge.js --email=${email} --ia=1.20`);
  console.log("     (nesse caso não use --renovar: a assinatura no Asaas será criada pela ativação)");
}

main()
  .catch((erro) => {
    console.error(`\nFalhou: ${erro.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
