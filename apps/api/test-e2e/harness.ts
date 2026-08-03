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

// Em ordem de dependência inversa; TRUNCATE ignora foreign key com o check
// desligado, mas manter a ordem deixa o erro legível se algo faltar.
const TABLES_TO_CLEAR = [
  "OrderStatusHistory",
  "OrderItem",
  "Delivery",
  "Payment",
  "Order",
  "DiningOrder",
  "TableSession",
  "RestaurantTable",
  "ProductAddon",
  "ProductVariation",
  "Product",
  "Category",
  "RolePermission",
  "EmployeeProfile",
  "CustomerProfile",
  "Address",
  "RefreshToken",
  "AccountToken",
  "IdentityDocument",
  "CompanySettings",
  "DeliveryArea",
  "User",
  "Company",
];

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
      return jwt.sign(
        { sub: user.id, email: user.email, role: user.role, companyId: user.companyId },
        {
          secret: process.env.JWT_ACCESS_SECRET,
          expiresIn: "15m",
          issuer: process.env.JWT_ISSUER ?? "chegowia-api",
          audience: process.env.JWT_AUDIENCE ?? "chegowia-web",
        },
      );
    },
    async reset() {
      await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
      for (const table of TABLES_TO_CLEAR) {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
      }
      await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
    },
    async close() {
      await app.close();
    },
  };
}
