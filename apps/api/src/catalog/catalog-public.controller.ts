import { Controller, Get, Param, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../common/decorators/public.decorator";
import { CatalogPublicService } from "./catalog-public.service";
import { SearchIntentService } from "../ai/search/search-intent.service";
import { PublicSearchDto } from "./dto/public-search.dto";

@ApiTags("catalog-public")
@Controller("catalog/public")
export class CatalogPublicController {
  constructor(
    private readonly catalogPublicService: CatalogPublicService,
    private readonly searchIntent: SearchIntentService,
  ) {}

  /**
   * Busca do marketplace assistida por IA. A interpretação volta junto com os
   * resultados para que a interface possa dizer à pessoa o que foi entendido e
   * quais termos além do digitado entraram na busca.
   *
   * Throttle próprio: é público e aciona um modelo, ainda que o cache do
   * SearchIntentService absorva as repetições.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get("search")
  async search(@Query() dto: PublicSearchDto) {
    const intent = await this.searchIntent.resolve(dto.query);
    const results = await this.catalogPublicService.searchPublic({
      terms: intent.terms,
      productTypeIds: intent.productTypeIds,
      maxPrice: intent.maxPrice,
      city: dto.city,
      page: dto.page,
      pageSize: dto.pageSize,
    });

    return {
      interpretation: {
        query: intent.query,
        terms: intent.terms,
        maxPrice: intent.maxPrice,
        explanation: intent.explanation,
        assisted: intent.source !== "fallback",
      },
      ...results,
    };
  }

  @Public()
  @Get("marketplace")
  getMarketplace(
    @Query("search") search?: string,
    @Query("city") city?: string,
    @Query("categoryId") categoryId?: string,
  ) {
    return this.catalogPublicService.getMarketplace({ search, city, categoryId });
  }

  /**
   * Fonte exclusiva do sitemap do site público. Só devolve identificadores e
   * datas de conteúdo que já é público — sem cadastro, pedidos ou dados de
   * clientes. O limite baixo protege o banco caso um crawler abuse da rota.
   */
  @Public()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Get("sitemap")
  getSitemap() {
    return this.catalogPublicService.getSitemapEntries();
  }

  /** Página pública individual: dá URL canônica e conteúdo verificável a
   * cada item do cardápio, sempre dentro do slug da empresa solicitada. */
  @Public()
  @Get(":slug/products/:productId")
  getProduct(@Param("slug") slug: string, @Param("productId") productId: string) {
    return this.catalogPublicService.getProductBySlugAndId(slug, productId);
  }

  @Public()
  @Get(":slug")
  getMenu(@Param("slug") slug: string) {
    return this.catalogPublicService.getMenuBySlug(slug);
  }
}
