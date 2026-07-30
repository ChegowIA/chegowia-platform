import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../common/decorators/public.decorator";
import { CatalogPublicService } from "./catalog-public.service";

@ApiTags("catalog-public")
@Controller("catalog/public")
export class CatalogPublicController {
  constructor(private readonly catalogPublicService: CatalogPublicService) {}

  @Public()
  @Get("marketplace")
  getMarketplace(
    @Query("search") search?: string,
    @Query("city") city?: string,
    @Query("categoryId") categoryId?: string,
  ) {
    return this.catalogPublicService.getMarketplace({ search, city, categoryId });
  }

  @Public()
  @Get(":slug")
  getMenu(@Param("slug") slug: string) {
    return this.catalogPublicService.getMenuBySlug(slug);
  }
}
