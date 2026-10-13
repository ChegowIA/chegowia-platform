import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { PrismaClient, Role } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { PRISMA_CLIENT } from "../src/common/prisma/prisma.constants";
import { GeographyService } from "../src/common/geography/geography.service";
import { assertTestDatabase } from "./database-url";

/**
 * Sobe o AppModule inteiro — interceptor de tenant, cadeia de guards, pipes,
 * filtros — contra o MySQL de teste. Os testes unitários mockam o Prisma e por
 * isso não conseguem provar isolamento multiempresa: o isolamento mora numa
 * extensão do Prisma que o mock substitui. Aqui ele é exercido de verdade.
 */
export interface Harness {
  app: INestApplication;
  prisma: PrismaClient;
  tokenFor(user: { id: string; email: string; role: Role; companyId: string | null }): string;
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Raízes dos dados que cada teste apaga.
 *
 * A lista antiga era escrita à mão e tinha 32 tabelas de menos — entre elas
 * `DeliveryIncident` e `FiscalDocument`, que apontam para `Delivery` e `Order`.
 * Cada tabela nova precisava ser lembrada aqui, e esquecer não dava erro
 * visível: a suíte só quebrava quando o `verify` passava a ponto de chegar
 * nela.
 *
 * Agora se declara apenas de onde partir e o resto sai do banco. O que **não**
 * é descendente destas raízes é dado de referência — `Permission`,
 * `SoftwarePlan`, `UsageRate` — e precisa sobreviver ao reset, senão a
 * aplicação sobe sem permissões nem planos.
 */
const CLEANUP_ROOTS = ["Company", "User", "IdentityDocument"];

/**
 * Ordem de exclusão: filho antes do pai.
 *
 * Não desligamos `FOREIGN_KEY_CHECKS`, e isso é a correção do bug: a variável é
 * de sessão, o Prisma tira conexões de um pool, e o `SET` ia para uma conexão
 * enquanto o `TRUNCATE` ia para outra. Em máquina com poucos núcleos o pool era
 * pequeno e coincidia; no CI, com doze, não coincidia — e o erro era
 * "Cannot truncate a table referenced in a foreign key constraint".
 *
 * `DELETE` na ordem certa satisfaz as chaves estrangeiras sem depender de
 * sessão nenhuma. É mais lento que `TRUNCATE`, o que não importa em tabelas de
 * teste, e as chaves primárias são cuid, então ninguém depende de reiniciar
 * auto incremento.
 */
async function deletionOrder(prisma: PrismaClient): Promise<string[]> {
  const vinculos = await prisma.$queryRawUnsafe<Array<{ child: string; parent: string }>>(
    `SELECT TABLE_NAME AS child, REFERENCED_TABLE_NAME AS parent
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IS NOT NULL
      GROUP BY TABLE_NAME, REFERENCED_TABLE_NAME`,
  );

  const filhos = new Map<string, Set<string>>();
  for (const { child, parent } of vinculos) {
    if (child === parent) continue;
    if (!filhos.has(parent)) filhos.set(parent, new Set());
    filhos.get(parent)!.add(child);
  }

  // Fecho transitivo: toda tabela que aponta para o alcance das raízes entra.
  const alcance = new Set(CLEANUP_ROOTS);
  const fila = [...CLEANUP_ROOTS];
  while (fila.length) {
    for (const filho of filhos.get(fila.pop()!) ?? []) {
      if (alcance.has(filho)) continue;
      alcance.add(filho);
      fila.push(filho);
    }
  }

  const ordem: string[] = [];
  const visitado = new Set<string>();
  const visita = (tabela: string) => {
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

let ordemDeExclusao: string[] | null = null;

export async function createHarness(): Promise<Harness> {
  assertTestDatabase(process.env.DATABASE_URL!);
  // Sem worker de cobrança nem limpeza periódica durante os testes.
  process.env.APP_ROLE = "api";

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    /**
     * Única dependência substituída. O cálculo de rota chama uma instância
     * pública do OSRM pela internet: manter isso no e2e tornaria a suíte lenta,
     * dependente de rede e sujeita a falhar por indisponibilidade de terceiro.
     * Todo o resto — banco, guards, interceptor de tenant — é o de verdade.
     */
    .overrideProvider(GeographyService)
    .useValue({
      calculateDrivingRoute: async () => ({ distanceKm: 2, durationMinutes: 10 }),
      geocode: async () => ({ latitude: -19.9227, longitude: -43.9451 }),
    })
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.setGlobalPrefix("api");
  await app.init();

  const prisma = moduleRef.get<PrismaClient>(PRISMA_CLIENT);
  const jwt = moduleRef.get(JwtService);

  return {
    app,
    prisma,
    tokenFor(user) {
      const startedAt = Date.now();
      return jwt.sign(
        {
          sub: user.id,
          email: user.email,
          role: user.role,
          companyId: user.companyId,
          mfaSessionStartedAt: startedAt,
          mfaSessionExpiresAt: startedAt + 24 * 60 * 60 * 1000,
        },
        {
          secret: process.env.JWT_ACCESS_SECRET,
          expiresIn: "15m",
          issuer: process.env.JWT_ISSUER ?? "chegowia-api",
          audience: process.env.JWT_AUDIENCE ?? "chegowia-web",
        },
      );
    },
    async reset() {
      // A ordem é lida do banco uma vez por processo: ela só muda com migration.
      ordemDeExclusao ??= await deletionOrder(prisma);
      for (const table of ordemDeExclusao) {
        await prisma.$executeRawUnsafe(`DELETE FROM \`${table}\``);
      }
    },
    async close() {
      await app.close();
    },
  };
}
