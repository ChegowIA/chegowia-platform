import { Body, Delete, Controller, Get, Patch, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { UsersService } from "./users.service";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { DeleteAccountDto } from "./dto/delete-account.dto";

@ApiTags("users")
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch("me")
  updateProfile(@CurrentUser("sub") userId: string, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Post("me/avatar")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 4 * 1024 * 1024 } }))
  uploadAvatar(@CurrentUser("sub") userId: string, @UploadedFile() file: any) {
    return this.usersService.uploadAvatar(userId, file);
  }

  @Patch("me/password")
  changePassword(@CurrentUser("sub") userId: string, @Body() dto: ChangePasswordDto) {
    return this.usersService.changePassword(userId, dto);
  }

  @Get("me/export")
  exportMyData(@CurrentUser("sub") userId: string) {
    return this.usersService.exportMyData(userId);
  }

  /**
   * Exclusão da conta pelo titular (LGPD art. 18, VI). Anonimiza em vez de
   * apagar: pedido é documento fiscal com guarda obrigatória de cinco anos.
   */
  @Delete("me")
  deleteMyAccount(@CurrentUser("sub") userId: string, @Body() dto: DeleteAccountDto) {
    return this.usersService.deleteMyAccount(userId, dto.password);
  }
}
