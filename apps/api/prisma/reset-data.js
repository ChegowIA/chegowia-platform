#!/usr/bin/env node
/**
 * Limpa os dados operacionais do banco, preservando o super administrador.
 *
 * Serve para zerar a base antes de entrar com clientes reais, sem recriar o
 * schema: as migrations continuam aplicadas e os dados de referência —
 * permissões, planos e tarifas de consumo — ficam de pé. Sem eles a aplicação
 * sobe sem plano para vender e sem permissão para conceder.
 *
 * A ordem de exclusão sai do próprio banco, não de uma lista escrita à mão. Uma
 * lista assim já existiu no harness de teste e chegou a ficar 32 tabelas
 * atrasada sem ninguém perceber, porque esquecer uma tabela nova não dá erro
 * visível — só quebra quando alguém finalmente roda.
 *
 * Uso:
 *
 *   node apps/api/prisma/reset-data.js
 *       Só mostra o que seria apagado. Não escreve nada.
 *
 *   node apps/api/prisma/reset-data.js --confirmar=<nome-do-banco>
 *       Executa. O nome tem de bater com o banco ao qual a conexão chegou —
 *       é o que impede rodar no banco errado por engano de variável.
 */
const { PrismaClient } = require("@prisma/client");

/**
 * Tabelas que não são de tenant e precisam sobreviver.
 *
 * `_prisma_migrations` fora daqui faria o Prisma achar que o banco nunca foi
 * migrado e tentar aplicar tudo de novo.
 */
const PRESERVADAS = new Set([
  "_prisma_migrations",
  "Permission",
  "SoftwarePlan",
  "UsageRate",
  "StripeEvent",
  // O WhatsApp institucional é da plataforma, não de nenhum cliente: apagar o
  // canal derrubaria o número da ChegowIA e exigiria reconectar no Gupshup.
  // Hoje ele sobreviveria de qualquer forma, por não ter chave estrangeira para
  // empresa nem usuário — mas isso é acidente, e uma coluna nova amanhã o
  // colocaria na varredura sem ninguém perceber. Aqui a intenção fica escrita.
  "PlatformWhatsAppChannel",
  "PlatformWhatsAppConversation",
  "PlatformWhatsAppMessage",
  "PlatformUsageLedger",
]);

/** De onde a limpeza parte. Tudo que aponta para isso, direta ou indiretamente, cai junto. */
const RAIZES = ["Company", "User", "IdentityDocument"];

async function ordemDeExclusao(prisma) {
  const vinculos = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME AS child, REFERENCED_TABLE_NAME AS parent
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IS NOT NULL
      GROUP BY TABLE_NAME, REFERENCED_TABLE_NAME`,
  );

  const filhos = new Map();
  for (const { child, parent } of vinculos) {
    if (child === parent) continue;
    if (!filhos.has(parent)) filhos.set(parent, new Set());
    filhos.get(parent).add(child);
  }

  const alcance = new Set(RAIZES);
  const fila = [...RAIZES];
  while (fila.length) {
    for (const filho of filhos.get(fila.pop()) ?? []) {
      if (alcance.has(filho) || PRESERVADAS.has(filho)) continue;
      alcance.add(filho);
      fila.push(filho);
    }
  }

  // Filho antes do pai: assim as chaves estrangeiras são satisfeitas sem
  // precisar desligar a checagem, que é variável de sessão e não sobrevive ao
  // pool de conexões.
  const ordem = [];
  const visitado = new Set();
  const visita = (tabela) => {
    if (visitado.has(tabela)) return;
    visitado.add(tabela);
    for (const filho of [...(filhos.get(tabela) ?? [])].sort()) {
      if (alcance.has(filho)) visita(filho);
    }
    ordem.push(tabela);
  };
  for (const tabela of [...alcance].sort()) visita(tabela);
  return ordem;
}

async function contar(prisma, tabela) {
  const [linha] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM \`${tabela}\``);
  return Number(linha.total);
}

/**
 * Avisa quando o banco tem registro que não deveria simplesmente sumir.
 *
 * Nota fiscal autorizada tem guarda obrigatória de cinco anos — é o mesmo
 * motivo pelo qual a exclusão de conta pelo titular anonimiza em vez de apagar.
 * Comissão paga e cobrança quitada são histórico financeiro de terceiros.
 *
 * O script não bloqueia: um banco de testes pode ter tudo isso e ser
 * descartável. Mas ninguém deve apagar essas linhas sem ter visto que existiam.
 */
async function avisarSobreRegistrosSensiveis(prisma) {
  const checagens = [
    {
      rotulo: "nota(s) fiscal(is) autorizada(s) ou cancelada(s)",
      sql: "SELECT COUNT(*) AS total FROM FiscalDocument WHERE status IN ('AUTORIZADA','CANCELADA')",
      nota: "documento fiscal tem guarda obrigatória de cinco anos",
    },
    {
      rotulo: "comissão(ões) já paga(s) a revendedor",
      sql: "SELECT COUNT(*) AS total FROM CommissionLedger WHERE status = 'PAGA'",
      nota: "é histórico de repasse a terceiro",
    },
    {
      rotulo: "assinatura(s) ativa(s) de cliente",
      sql: "SELECT COUNT(*) AS total FROM ClientSubscription WHERE status = 'ATIVA'",
      nota: "há cliente pagando hoje",
    },
  ];

  const achados = [];
  for (const { rotulo, sql, nota } of checagens) {
    try {
      const [linha] = await prisma.$queryRawUnsafe(sql);
      const total = Number(linha.total);
      if (total > 0) achados.push(`  ${total} ${rotulo} — ${nota}`);
    } catch {
      // Tabela ausente num banco antigo não pode impedir o diagnóstico.
    }
  }

  if (!achados.length) return;
  console.log("\nATENÇÃO — este banco tem registros que costumam ser definitivos:\n");
  for (const achado of achados) console.log(achado);
  console.log(
    "\n  Se este for o banco de produção, confirme com a contabilidade antes de seguir.\n"
    + "  Para tirar lojas de teste do ar sem apagar nada, marque a empresa como\n"
    + "  isTestOnly ou inativa — some do catálogo e é reversível.",
  );
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const [{ atual }] = await prisma.$queryRawUnsafe("SELECT DATABASE() AS atual");
    const confirmacao = process.argv
      .find((arg) => arg.startsWith("--confirmar="))
      ?.split("=")[1];

    const ordem = await ordemDeExclusao(prisma);
    const superAdmins = await prisma.$queryRawUnsafe(
      "SELECT email FROM User WHERE role = 'SUPER_ADMIN' ORDER BY email",
    );

    console.log(`\nBanco: ${atual}\n`);

    if (!superAdmins.length) {
      console.error(
        "Nenhum SUPER_ADMIN neste banco. A limpeza deixaria a plataforma sem ninguém\n"
        + "para entrar e criar empresas. Rode o seed antes, ou confira se a conexão\n"
        + "chegou ao banco certo.\n",
      );
      process.exitCode = 1;
      return;
    }

    console.log("Preservados:");
    for (const { email } of superAdmins) console.log(`  super admin  ${email}`);
    for (const tabela of [...PRESERVADAS].filter((t) => !t.startsWith("_")).sort()) {
      console.log(`  tabela       ${tabela} (${await contar(prisma, tabela)} linha(s))`);
    }

    await avisarSobreRegistrosSensiveis(prisma);

    console.log("\nSerão apagados:");
    let total = 0;
    for (const tabela of ordem) {
      const linhas = tabela === "User"
        ? await contar(prisma, "User") - superAdmins.length
        : await contar(prisma, tabela);
      total += linhas;
      if (linhas > 0) console.log(`  ${String(linhas).padStart(6)}  ${tabela}`);
    }
    console.log(`\n  ${String(total).padStart(6)}  linhas no total\n`);

    if (confirmacao !== atual) {
      console.log(
        confirmacao
          ? `Nada foi apagado: "${confirmacao}" não é o banco desta conexão ("${atual}").\n`
          : `Nada foi apagado. Para executar:\n\n  node apps/api/prisma/reset-data.js --confirmar=${atual}\n`,
      );
      return;
    }

    for (const tabela of ordem) {
      // O super administrador é o único que sobrevive à limpeza: é por ele que
      // a plataforma volta a existir.
      const sql = tabela === "User"
        ? "DELETE FROM `User` WHERE role <> 'SUPER_ADMIN'"
        : `DELETE FROM \`${tabela}\``;
      const afetadas = await prisma.$executeRawUnsafe(sql);
      if (afetadas > 0) console.log(`  apagado  ${String(afetadas).padStart(6)}  ${tabela}`);
    }

    console.log(`\nPronto. O banco ${atual} está limpo, com o super administrador preservado.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro) => {
  console.error("\nFalhou:", erro.message, "\n");
  process.exitCode = 1;
});
