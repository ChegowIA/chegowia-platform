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
 *   node apps/api/prisma/simulate-usage-charge.js --email=dono@empresa.com
 *   node apps/api/prisma/simulate-usage-charge.js --email=dono@empresa.com --ia=3.50
 *
 * Com `--renovar`, encerra a assinatura no Asaas e cria outra vencendo hoje. É o
 * único jeito de repetir o ciclo quando a assinatura é de cartão com fatura paga:
 * o Asaas recusa antecipar o vencimento dessas. Simula a virada de mês, e é o
 * cenário em que o consumo entra somado à mensalidade na mesma fatura:
 *   node ... --renovar --mensalidade=5 --ia=1.20
 *
 * Com `--vencer`, faz o ciclo seguinte inteiro: cria a cobrança do mês, espera a
 * rotina somar o consumo a ela e então joga o vencimento para ontem, como se o
 * dia da cobrança tivesse chegado. Implica `--renovar`:
 *   node ... --vencer --mensalidade=5 --ia=1.20
 *
 * Reverter os lançamentos de teste (não apaga cobrança no Asaas):
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

// `dueDate` no Asaas é uma data no fuso brasileiro. `toISOString()` muda para
// amanhã depois das 21h em São Paulo, fazendo um teste de vencimento parecer em
// dia; montamos a data pelas partes para não depender do timezone do container.
function dataSaoPaulo(data = new Date()) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(data);
  const valores = Object.fromEntries(
    partes.filter((parte) => parte.type !== "literal").map((parte) => [parte.type, parte.value]),
  );
  return `${valores.year}-${valores.month}-${valores.day}`;
}

/**
 * Encerra a assinatura atual no Asaas e cria outra vencendo hoje.
 *
 * Necessário porque assinatura de cartão com fatura paga não aceita mudança de
 * vencimento. Encerrar antes de criar evita duas assinaturas cobrando a mesma
 * empresa — o erro mais caro possível aqui.
 *
 * A cobrança nasce com a forma de pagamento aberta, então fica PENDENTE até
 * alguém pagar: é essa janela que permite somar o consumo a ela.
 */
async function renovarAssinatura(assinatura, mensalidadeInformada) {
  if (!assinatura.asaasCustomerId) {
    throw new Error("A assinatura não tem cliente no Asaas; ative pelo painel antes de renovar.");
  }
  const valor = Number(mensalidadeInformada ?? assinatura.plan.monthlyPrice);
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error("Informe --mensalidade com um valor positivo.");
  }

  if (assinatura.asaasSubscriptionId) {
    await asaas(`/subscriptions/${encodeURIComponent(assinatura.asaasSubscriptionId)}`, { method: "DELETE" });
    console.log(`2. Assinatura ${assinatura.asaasSubscriptionId} encerrada no Asaas.`);
  } else {
    console.log("2. Nenhuma assinatura anterior no Asaas para encerrar.");
  }

  const hoje = dataSaoPaulo();
  const nova = await asaas("/subscriptions", {
    method: "POST",
    body: {
      customer: assinatura.asaasCustomerId,
      value: valor,
      nextDueDate: hoje,
      cycle: "MONTHLY",
      billingType: "UNDEFINED",
      description: `ChegowIA — ${assinatura.plan.name}`,
      externalReference: assinatura.id,
    },
  });
  const lista = await asaas(`/subscriptions/${encodeURIComponent(nova.id)}/payments?limit=20`);
  const emAberto = (lista?.data ?? []).find((item) => ["PENDING", "AWAITING_RISK_ANALYSIS"].includes(item.status));

  await prisma.clientSubscription.update({
    where: { id: assinatura.id },
    data: {
      asaasSubscriptionId: nova.id,
      asaasPaymentId: emAberto?.id ?? null,
      // O valor do teste também vai para o snapshot, senão a tela mostraria uma
      // mensalidade diferente da que está na fatura.
      monthlyPriceSnapshot: valor,
    },
  });
  console.log(`   Nova assinatura ${nova.id} de ${reais(valor)} vencendo ${hoje}.`);
  if (emAberto) {
    console.log(`   Cobrança em aberto: ${emAberto.id} · ${reais(emAberto.value)}`);
    if (emAberto.invoiceUrl) console.log(`   Fatura: ${emAberto.invoiceUrl}`);
  } else {
    console.log("   O Asaas ainda não gerou a cobrança; rode de novo em alguns segundos.");
  }
  return emAberto ?? null;
}

/**
 * Espera a rotina somar o consumo e então joga o vencimento para ontem.
 *
 * A ordem importa: a rotina só altera cobrança PENDING, então vencer antes de o
 * consumo entrar deixaria a fatura sem ele. Por isso o script confere o valor
 * antes de mexer na data, em vez de confiar no tempo.
 *
 * O Asaas troca o status para OVERDUE na virada do dia dele, não na hora — o que
 * o script garante é a data vencida, não o rótulo.
 */
async function vencerCobranca(cobranca, valorIa) {
  const esperado = Math.round((Number(cobranca.value) + valorIa) * 100) / 100;
  console.log(`\nEsperando o consumo entrar na cobrança (alvo ${reais(esperado)})...`);

  let atual = null;
  for (let tentativa = 0; tentativa < 15; tentativa += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    atual = await asaas(`/payments/${encodeURIComponent(cobranca.id)}`);
    if (Math.round(Number(atual.value) * 100) / 100 >= esperado) break;
    atual = null;
  }

  if (!atual) {
    console.log("O consumo não entrou na cobrança em 45s. Não vou vencer a fatura sem ele — ficaria incompleta.");
    console.log("Verifique nos logs se a rotina está rodando (procure por \"acumulando\" ou erro do Asaas).");
    return;
  }
  console.log(`Consumo somado: a cobrança está em ${reais(atual.value)}.`);

  const ontem = dataSaoPaulo(new Date(Date.now() - 24 * 60 * 60 * 1000));
  await asaas(`/payments/${encodeURIComponent(cobranca.id)}`, { method: "POST", body: { dueDate: ontem } });
  console.log(`Vencimento movido para ${ontem}.`);

  const assinaturaLocal = await prisma.clientSubscription.findFirst({
    where: { asaasPaymentId: cobranca.id },
    select: { id: true },
  });
  if (assinaturaLocal) {
    await prisma.clientSubscription.update({
      where: { id: assinaturaLocal.id },
      data: { currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
  }

  console.log("\nO Asaas marca OVERDUE na virada do dia dele, não neste instante.");
  console.log("A conciliação bloqueia o painel em até um minuto, mesmo com o webhook desligado.");
}

async function main() {
  const email = arg("email", "contato@chegowia.com.br");
  const valorIa = Number(arg("ia", "1.20"));
  const limpar = process.argv.includes("--limpar");
  const vencer = process.argv.includes("--vencer");
  const renovar = process.argv.includes("--renovar") || vencer;

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

  // 2. Cobrança da mensalidade em aberto, para o consumo ter onde ser somado.
  let cobranca = null;
  if (renovar) {
    cobranca = await renovarAssinatura(assinatura, arg("mensalidade", null));
  } else if (assinatura.asaasSubscriptionId) {
    const hoje = dataSaoPaulo();
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
  // O painel marca como "sem taxa ativa" qualquer lançamento que não carregue
  // a tarifa que originou o valor. Como esta simulação já usa a métrica real de
  // IA, vinculamos a taxa ativa quando ela existir — assim o alerta continua
  // reservado para um problema de precificação de verdade.
  const taxaDeIa = await prisma.usageRate.findFirst({
    where: { metric: "IA_TOKENS_SAIDA", isActive: true },
    select: { id: true },
  });
  await prisma.usageLedger.create({
    data: {
      companyId,
      usageRateId: taxaDeIa?.id ?? null,
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
  if (!taxaDeIa) {
    console.warn("   Aviso: não há taxa ativa para IA_TOKENS_SAIDA; o painel sinalizará esse lançamento como sem precificação.");
  }

  console.log("\nA rotina de fundo roda a cada 5 segundos. O que esperar:");
  if (cobranca) {
    console.log(
      `  A mensalidade ${cobranca.id} deve passar de ${reais(cobranca.value)} para ${reais(Number(cobranca.value) + valorIa)}.`,
    );
  } else {
    console.log("  Sem mensalidade em aberto, o consumo fica pendente e entra na cobrança seguinte.");
    console.log("  Nunca sai cobrança à parte: a regra é uma fatura só, com o total.");
  }
  console.log("Confira em Cobranças no painel do Asaas, ou em /painel/assinatura na aba Faturas.");

  if (vencer && cobranca) {
    await vencerCobranca(cobranca, valorIa);
  } else if (vencer) {
    console.log("\nNada a vencer: não há cobrança em aberto.");
  }
}

main()
  .catch((erro) => {
    console.error(`\nFalhou: ${erro.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
