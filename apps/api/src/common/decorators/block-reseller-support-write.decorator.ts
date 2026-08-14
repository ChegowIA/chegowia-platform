import { SetMetadata } from "@nestjs/common";

export const BLOCK_RESELLER_SUPPORT_WRITE_KEY = "block-reseller-support-write";

/** Bloqueia mutações quando a rota é aberta por suporte de superadmin. */
export const BlockResellerSupportWrite = () => SetMetadata(BLOCK_RESELLER_SUPPORT_WRITE_KEY, true);
