import { Module } from "@nestjs/common";
import { CategoriesController } from "./categories.controller";
import { CategoriesService } from "./categories.service";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";
import { CatalogPublicController } from "./catalog-public.controller";
import { CatalogPublicService } from "./catalog-public.service";
import { AiModule } from "../ai/ai.module";

@Module({
  imports: [AiModule],
  controllers: [CategoriesController, ProductsController, CatalogPublicController],
  providers: [CategoriesService, ProductsService, CatalogPublicService],
  exports: [CategoriesService, ProductsService, CatalogPublicService],
})
export class CatalogModule {}
