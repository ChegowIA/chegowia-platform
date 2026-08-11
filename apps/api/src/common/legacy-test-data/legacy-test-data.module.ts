import { Global, Module } from "@nestjs/common";
import { LegacyTestDataService } from "./legacy-test-data.service";

/**
 * Protege dados que foram criados durante a homologação fechada.
 *
 * O módulo é global porque as superfícies públicas (catálogo, IA, pedidos e
 * links de WhatsApp) precisam aplicar exatamente a mesma regra. Ele não cria
 * nenhuma exceção por IP, e-mail ou papel: registros `isTestOnly` só deixam de
 * ser ocultos depois de uma decisão administrativa explícita.
 */
@Global()
@Module({
  providers: [LegacyTestDataService],
  exports: [LegacyTestDataService],
})
export class LegacyTestDataModule {}
