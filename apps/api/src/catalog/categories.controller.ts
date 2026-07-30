import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PermissionKey } from "@chegowia/shared";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { CategoriesService } from "./categories.service";
import { CreateCategoryDto, UpdateCategoryDto } from "./dto/category.dto";

@ApiTags("catalog")
@Controller("catalog/categories")
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @RequirePermission(PermissionKey.CARDAPIO_VISUALIZAR)
  @Get()
  list() {
    return this.categoriesService.list();
  }

  @RequirePermission(PermissionKey.CARDAPIO_EDITAR)
  @Post()
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @RequirePermission(PermissionKey.CARDAPIO_EDITAR)
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(id, dto);
  }

  @RequirePermission(PermissionKey.CARDAPIO_EDITAR)
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.categoriesService.remove(id);
  }
}
