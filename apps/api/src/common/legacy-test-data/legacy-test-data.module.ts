import { Global, Module } from "@nestjs/common";
import { GeographyModule } from "../geography/geography.module";
import { LegacyTestDataService } from "./legacy-test-data.service";

/**
 * Protege dados que foram criados durante a homologação fechada.
 *
 * O módulo é global porque as superfícies públicas (catálogo, IA, pedidos e
 * links de WhatsApp) precisam aplicar exatamente a mesma regra. A única
 * exceção é a demonstração privada, limitada no código a uma conta específica
 * e ao endereço dela dentro da área de entrega; ela não abre a loja ao público.
 */
@Global()
@Module({
  imports: [GeographyModule],
  providers: [LegacyTestDataService],
  exports: [LegacyTestDataService],
})
export class LegacyTestDataModule {}
