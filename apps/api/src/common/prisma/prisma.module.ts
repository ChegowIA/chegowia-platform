import { Global, Inject, Module, OnApplicationShutdown } from "@nestjs/common";
import { createExtendedPrismaClient, ExtendedPrismaClient } from "./prisma-client.factory";
import { PRISMA_CLIENT } from "./prisma.constants";

@Global()
@Module({
  providers: [
    {
      provide: PRISMA_CLIENT,
      useFactory: (): ExtendedPrismaClient => createExtendedPrismaClient(),
    },
  ],
  exports: [PRISMA_CLIENT],
})
export class PrismaModule implements OnApplicationShutdown {
  constructor(@Inject(PRISMA_CLIENT) private readonly client: ExtendedPrismaClient) {}

  async onApplicationShutdown() {
    await (this.client as any).$disconnect();
  }
}
