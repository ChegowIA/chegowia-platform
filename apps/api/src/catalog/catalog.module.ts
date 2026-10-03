import { Module } from "@nestjs/common";
import { CategoriesController } from "./categories.controller";
import { CategoriesService } from "./categories.service";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";
import { CatalogPublicController } from "./catalog-public.controller";
import { CatalogPublicService } from "./catalog-public.service";
import { AiModule } from "../ai/ai.module";
import { CatalogImportService } from "./catalog-import.service";
import { GeographyModule } from "../common/geography/geography.module";

@Module({
  imports: [AiModule, GeographyModule],
  controllers: [CategoriesController, ProductsController, CatalogPublicController],
  providers: [CategoriesService, ProductsService, CatalogPublicService, CatalogImportService],
  exports: [CategoriesService, ProductsService, CatalogPublicService, CatalogImportService],
})
export class CatalogModule {}
