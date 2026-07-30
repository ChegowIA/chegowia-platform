import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PromotionStatus, Role } from "@prisma/client";
import { Roles } from "../common/decorators/roles.decorator";
import { Public } from "../common/decorators/public.decorator";
import { PromotionsService } from "./promotions.service";
import { CreatePromotionDto } from "./dto/create-promotion.dto";

@ApiTags("promotions")
@Roles(Role.ADMIN, Role.FUNCIONARIO)
@Controller("promotions")
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get()
  list() {
    return this.promotionsService.list();
  }

  @Post()
  create(@Body() dto: CreatePromotionDto) {
    return this.promotionsService.create(dto);
  }

  @Patch(":id/status")
  setStatus(@Param("id") id: string, @Body("status") status: PromotionStatus) {
    return this.promotionsService.setStatus(id, status);
  }
}

@ApiTags("promotions-public")
@Public()
@Controller("promotions/public")
export class PublicPromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get()
  list(@Query("city") city?: string) {
    return this.promotionsService.publicList({ city });
  }
}
