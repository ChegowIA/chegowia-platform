import { SetMetadata } from "@nestjs/common";

export const ALLOW_INACTIVE_SUBSCRIPTION_KEY = "allowInactiveSubscription";
export const AllowInactiveSubscription = () =>
  SetMetadata(ALLOW_INACTIVE_SUBSCRIPTION_KEY, true);
