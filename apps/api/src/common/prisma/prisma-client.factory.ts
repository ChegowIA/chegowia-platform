import { ForbiddenException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { tenantContext } from "../tenant/tenant-context";

/**
 * Models operacionais que possuem `companyId` direto e cujas queries devem ser
 * automaticamente restritas à empresa do contexto atual. Isso é uma camada extra
 * de proteção (defense in depth) — os services ainda devem filtrar explicitamente
 * por companyId; isolamento multiempresa nunca deve depender de um único mecanismo.
 * Não cobre models sem `companyId` direto (ex.: OrderItem, ProductVariation) — o
 * acesso a esses deve sempre passar pelo model pai já escopado.
 */
const TENANT_MODELS = new Set([
  "CompanySettings",
  "DeliveryArea",
  "EmployeeProfile",
  "CustomerProfile",
  "Category",
  "Product",
  "Order",
  "Delivery",
  "Payment",
  "Promotion",
  "AIConversation",
  "AIActionLog",
  "MessagingChannel",
]);

const FILTERED_READ_OPS = new Set(["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy"]);
const FILTERED_MANY_WRITE_OPS = new Set(["updateMany", "deleteMany"]);
const FILTERED_UNIQUE_OPS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete"]);

export function createExtendedPrismaClient() {
  const prisma = new PrismaClient();

  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) {
            return query(args);
          }

          const ctx = tenantContext.get();
          if (!ctx || ctx.bypass) {
            return query(args);
          }

          if (!ctx.companyId) {
            throw new ForbiddenException(
              "Contexto de empresa ausente para esta operação multiempresa.",
            );
          }
          const companyId = ctx.companyId;
          const anyArgs = args as Record<string, any>;

          if (FILTERED_READ_OPS.has(operation) || FILTERED_MANY_WRITE_OPS.has(operation)) {
            anyArgs.where = anyArgs.where ? { AND: [anyArgs.where, { companyId }] } : { companyId };
          } else if (FILTERED_UNIQUE_OPS.has(operation)) {
            anyArgs.where = { ...anyArgs.where, companyId };
          } else if (operation === "create") {
            if (anyArgs.data && typeof anyArgs.data === "object" && anyArgs.data.companyId === undefined) {
              anyArgs.data.companyId = companyId;
            }
          } else if (operation === "createMany" && Array.isArray(anyArgs.data)) {
            anyArgs.data = anyArgs.data.map((row: any) =>
              row.companyId === undefined ? { ...row, companyId } : row,
            );
          }

          return query(anyArgs);
        },
      },
    },
  });
}

export type ExtendedPrismaClient = ReturnType<typeof createExtendedPrismaClient>;
