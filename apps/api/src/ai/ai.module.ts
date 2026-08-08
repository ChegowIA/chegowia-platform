import { Module } from "@nestjs/common";
import { AI_PROVIDER } from "./providers/ai-provider.interface";
import { DeepSeekProvider } from "./providers/deepseek.provider";
import { PromptBuilderService } from "./prompt-builder.service";
import { ToolsService } from "./tools/tools.service";
import { AiService } from "./ai.service";
import { AiController } from "./ai.controller";
import { AiMotoboyController } from "./ai-motoboy.controller";
import { AiGarcomController } from "./ai-garcom.controller";
import { AiCozinhaController } from "./ai-cozinha.controller";
import { AiPublicController, AiPublicDiscoveryController } from "./ai-public.controller";
import { PromotionsService } from "./promotions.service";
import { PromotionsController, PublicPromotionsController } from "./promotions.controller";
import { UsageModule } from "../usage/usage.module";
import { SearchIntentService } from "./search/search-intent.service";
import { OrdersModule } from "../orders/orders.module";

/**
 * Troca de provedor de IA é configuração, não código: AI_PROVIDER=deepseek (padrão)
 * hoje; adicionar OpenAI/Claude/Gemini no futuro é implementar AIProvider (ver
 * providers/ai-provider.interface.ts) e adicionar um `case` aqui.
 */
const aiProviderFactory = {
  provide: AI_PROVIDER,
  useFactory: () => {
    const provider = process.env.AI_PROVIDER ?? "deepseek";
    switch (provider) {
      case "deepseek":
      default:
        return new DeepSeekProvider();
    }
  },
};

@Module({
  imports: [UsageModule, OrdersModule],
  controllers: [
    AiController,
    AiMotoboyController,
    AiGarcomController,
    AiCozinhaController,
    AiPublicController,
    AiPublicDiscoveryController,
    PromotionsController,
    PublicPromotionsController,
  ],
  providers: [aiProviderFactory, PromptBuilderService, ToolsService, AiService, PromotionsService, SearchIntentService],
  exports: [AiService, AI_PROVIDER, SearchIntentService],
})
export class AiModule {}
