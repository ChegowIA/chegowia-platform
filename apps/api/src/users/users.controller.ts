import { Body, Controller, Patch, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { UsersService } from "./users.service";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";

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
}
