/**
 * Prepara um cenário de teste: mensalidade vencida com consumo de IA pendente.
 *
 * Serve para validar que o consumo variável entra somado à mensalidade, na mesma
 * cobrança, em vez de virar uma segunda fatura. Faz três coisas:
 *
 *   1. joga o fim do período para o passado (mensalidade vencida);
 *   2. antecipa o vencimento da assinatura no Asaas, o que faz a próxima
 *      cobrança ser gerada agora em vez de esperar o ciclo virar;
 *   3. lança R$ 1,20 de consumo de IA como pendente para a empresa.
 *
 * O resto é o próprio sistema: a rotina de fundo roda a cada 5s, encontra a
 * cobrança em aberto e soma o consumo ao valor dela.
 *
 * Em JavaScript puro pelo mesmo motivo do create-super-admin.js: a imagem de
 * produção não tem ts-node nem o package.json do apps/api.
 *
 * Uso no shell do Render:
 *   node apps/api/prisma/simulate-usage-charge.js
 *   node apps/api/prisma/simulate-usage-charge.js --email=outro@dominio.com --ia=3.50
 *
 * Reverter o consumo lançado (não desfaz o que já entrou em cobrança):
 *   node apps/api/prisma/simulate-usage-charge.js --limpar
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const REFERENCIA = "teste-consumo-ia-manual";

function arg(nome, padrao) {
  const encontrado = process.argv.find((item) => item.startsWith(`--${nome}=`));
  return encontrado ? encontrado.slice(nome.length + 3) : padrao;
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
  const texto = await resposta.text();
  let corpo = null;
  try { corpo = texto ? JSON.parse(texto) : null; } catch { corpo = null; }
  // O Asaas devolve parte das recusas com HTTP 200 e `errors` no corpo.
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

async function main() {
  const email = arg("email", "contato@chegowia.com.br");
  const valorIa = Number(arg("ia", "1.20"));
  const limpar = process.argv.includes("--limpar");

  if (!Number.isFinite(valorIa) || valorIa <= 0) {
    throw new Error("Informe --ia com um valor positivo, por exemplo --ia=1.20");
  }

  const usuario = await prisma.user.findFirst({
    where: { email, companyId: { not: null } },
    select: { companyId: true, company: { select: { name: true } } },
  });
  if (!usuario?.companyId) {
    throw new Error(`Nenhuma empresa vinculada ao e-mail ${email}.`);
  }
  const companyId = usuario.companyId;

  if (limpar) {
    // Remove qualquer lançamento desta simulação, inclusive os já sincronizados:
    // são dados de teste, identificados pela referência, e deixá-los para trás
    // sujaria o histórico de consumo da empresa.
    const alvos = await prisma.usageLedger.findMany({
      where: { companyId, externalReference: { startsWith: REFERENCIA } },
      select: { id: true, status: true, asaasPaymentId: true, billableAmount: true },
    });
    const emCobranca = alvos.filter((item) => item.asaasPaymentId);
    await prisma.usageLedger.deleteMany({ where: { id: { in: alvos.map((item) => item.id) } } });
    console.log(`Removidos ${alvos.length} lançamento(s) de teste.`);
    if (emCobranca.length) {
      console.log("\nATENÇÃO: estes lançamentos já tinham entrado em cobrança no Asaas:");
      for (const item of emCobranca) {
        console.log(`  ${item.asaasPaymentId} · ${reais(item.billableAmount)} · ${item.status}`);
      }
      console.log("Apague essas cobranças no painel do Asaas; o script não mexe em dinheiro.");
    }
    return;
  }

  const assinatura = await prisma.clientSubscription.findUnique({
    where: { companyId },
    include: { plan: { select: { name: true, monthlyPrice: true } } },
  });
  if (!assinatura) throw new Error(`A empresa ${usuario.company?.name} não tem assinatura.`);

  console.log(`Empresa: ${usuario.company?.name} (${companyId})`);
  console.log(`Assinatura: ${assinatura.status} · plano ${assinatura.plan.name} · ${reais(assinatura.plan.monthlyPrice)}`);

  if (assinatura.status !== "ATIVA") {
    console.warn(
      `\nAVISO: a assinatura está ${assinatura.status}. O consumo variável só é somado à cobrança de assinatura ATIVA — `
      + "com outro status o lançamento fica pendente esperando o próximo ciclo.",
    );
  }

  // 1. Mensalidade vencida.
  const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await prisma.clientSubscription.update({
    where: { id: assinatura.id },
    data: { currentPeriodEnd: ontem },
  });
  console.log(`\n1. Fim do período movido para ${ontem.toLocaleString("pt-BR")} (mensalidade vencida).`);

  // 2. Antecipa o vencimento no Asaas para a cobrança ser gerada agora.
  let cobranca = null;
  if (assinatura.asaasSubscriptionId) {
    const hoje = new Date().toISOString().slice(0, 10);
    try {
      await asaas(`/subscriptions/${encodeURIComponent(assinatura.asaasSubscriptionId)}`, {
        method: "POST",
        body: { nextDueDate: hoje },
      });
    } catch (erro) {
      // Assinatura no cartão com fatura paga não aceita antecipação — o Asaas
      // gera e captura no vencimento. Nesse caso não existe mensalidade em
      // aberto, e o consumo virará uma cobrança própria.
      console.log(`2. Não foi possível antecipar o vencimento: ${erro.message}`);
      console.log("   O consumo será cobrado em fatura própria (comportamento esperado no cartão).");
    }
    const lista = await asaas(`/subscriptions/${encodeURIComponent(assinatura.asaasSubscriptionId)}/payments?limit=20`);
    cobranca = (lista?.data ?? []).find((item) => ["PENDING", "AWAITING_RISK_ANALYSIS"].includes(item.status));
    if (cobranca) {
      console.log(`2. Mensalidade em aberto: ${cobranca.id} · ${reais(cobranca.value)} · vence ${cobranca.dueDate}`);
    }
  } else {
    console.log("2. Sem assinatura no Asaas: nada a antecipar (o consumo fica pendente até existir cobrança).");
  }

  // 3. Consumo de IA pendente. Chave única por execução para poder repetir.
  const referencia = `${REFERENCIA}-${ontem.getTime()}`;
  await prisma.usageLedger.create({
    data: {
      companyId,
      source: "IA",
      metric: "IA_TOKENS_SAIDA",
      quantity: 1000,
      // Custo de fornecedor abaixo do cobrado: é a margem, e o teste fica realista.
      providerAmount: Math.round(valorIa * 0.35 * 1e6) / 1e6,
      billableAmount: valorIa,
      currency: "brl",
      externalReference: referencia,
      // Consumo de teste gratuito nunca é faturado; este precisa ser faturável.
      trialCoveredAt: null,
      status: "PENDENTE",
    },
  });
  console.log(`3. Lançado ${reais(valorIa)} de consumo de IA como pendente (ref. ${referencia}).`);

  const minimo = Number(process.env.ASAAS_USAGE_MIN_CHARGE ?? 5);
  console.log("\nA rotina de fundo roda a cada 5 segundos. O que esperar:");
  if (cobranca) {
    console.log(
      `  A mensalidade ${cobranca.id} deve passar de ${reais(cobranca.value)} para ${reais(Number(cobranca.value) + valorIa)}.`,
    );
  } else if (valorIa >= minimo) {
    console.log(`  Uma cobrança própria de ${reais(valorIa)} deve ser criada, com vencimento em 5 dias.`);
  } else {
    console.log(
      `  Nada será cobrado agora: ${reais(valorIa)} está abaixo do mínimo de ${reais(minimo)} para emitir cobrança avulsa.`,
    );
    console.log(`  O lançamento fica pendente e acumula. Para ver a cobrança sair, use --ia=${minimo.toFixed(2)} ou mais.`);
  }
  console.log("Confira em Cobranças no painel do Asaas, ou em /painel/assinatura na aba Faturas.");
}

main()
  .catch((erro) => {
    console.error(`\nFalhou: ${erro.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
