import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OrdersService } from "./orders.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { DeliveryQuoteDto } from "./dto/delivery-quote.dto";

@ApiTags("my-orders")
@Roles(Role.CLIENTE)
@Controller("me/orders")
export class MyOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post("quote")
  quote(@CurrentUser("sub") customerId: string, @Body() dto: DeliveryQuoteDto) {
    return this.ordersService.quoteForCustomer(customerId, dto);
  }

  @Post()
  create(@CurrentUser("sub") customerId: string, @Body() dto: CreateOrderDto) {
    return this.ordersService.createForCustomer(customerId, dto);
  }

  @Get()
  list(@CurrentUser("sub") customerId: string) {
    return this.ordersService.myOrders(customerId);
  }

  @Get(":id")
  findById(@CurrentUser("sub") customerId: string, @Param("id") id: string) {
    return this.ordersService.myOrderDetail(customerId, id);
  }

  @Post(":id/repeat")
  repeat(@CurrentUser("sub") customerId: string, @Param("id") id: string) {
    return this.ordersService.repeat(customerId, id);
  }
}
