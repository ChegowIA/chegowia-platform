import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OptionalJwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { CatalogPublicService } from "./catalog-public.service";
import { SearchIntentService } from "../ai/search/search-intent.service";
import { PublicSearchDto } from "./dto/public-search.dto";
import { PermissionKey } from "@chegowia/shared";
import { RequirePermission } from "../common/decorators/require-permission.decorator";

@ApiTags("catalog-public")
@Controller("catalog/public")
@UseGuards(OptionalJwtAuthGuard)
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
  async search(@Query() dto: PublicSearchDto, @CurrentUser() viewer?: JwtPayload) {
    const intent = await this.searchIntent.resolve(dto.query);
    const results = await this.catalogPublicService.searchPublic({
      terms: intent.terms,
      productTypeIds: intent.productTypeIds,
      maxPrice: intent.maxPrice,
      city: dto.city,
      state: dto.state,
      zipCode: dto.zipCode,
      page: dto.page,
      pageSize: dto.pageSize,
    }, viewer);

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
    @Query("state") state?: string,
    @Query("zipCode") zipCode?: string,
    @Query("categoryId") categoryId?: string,
    @CurrentUser() viewer?: JwtPayload,
  ) {
    return this.catalogPublicService.getMarketplace({ search, city, state, zipCode, categoryId }, viewer);
  }

  /**
   * Fonte exclusiva do sitemap do site público. Só devolve identificadores e
   * datas de conteúdo que já é público — sem cadastro, pedidos ou dados de
   * clientes. O limite baixo protege o banco caso um crawler abuse da rota.
   */
  @Public()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Get("sitemap")
  getSitemap(@CurrentUser() viewer?: JwtPayload) {
    return this.catalogPublicService.getSitemapEntries(viewer);
  }

  /** Prévia autenticada: mesma seleção ativa do cardápio público, sem exigir que a loja esteja publicada. */
  @RequirePermission(PermissionKey.CARDAPIO_VISUALIZAR)
  @Get("preview/me")
  getMyPreview(@CurrentUser("companyId") companyId: string) {
    return this.catalogPublicService.getMenuPreview(companyId);
  }

  /** Página pública individual: dá URL canônica e conteúdo verificável a
   * cada item do cardápio, sempre dentro do slug da empresa solicitada. */
  @Public()
  @Get(":slug/products/:productId")
  getProduct(
    @Param("slug") slug: string,
    @Param("productId") productId: string,
    @CurrentUser() viewer?: JwtPayload,
  ) {
    return this.catalogPublicService.getProductBySlugAndId(slug, productId, viewer);
  }

  @Public()
  @Get(":slug")
  getMenu(@Param("slug") slug: string, @CurrentUser() viewer?: JwtPayload) {
    return this.catalogPublicService.getMenuBySlug(slug, viewer);
  }
}
