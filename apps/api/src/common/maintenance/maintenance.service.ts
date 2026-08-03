import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from "@nestjs/common";
import { LocalStorageService } from "../storage/local-storage.service";
import { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { PRISMA_CLIENT } from "../prisma/prisma.constants";
import { runsBackgroundJobs } from "../config/app-role";

const SIX_HOURS_MS = 6 * 60 * 60 * 1_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const NINETY_DAYS_MS = 90 * ONE_DAY_MS;

@Injectable()
export class MaintenanceService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceService.name);
  private interval?: NodeJS.Timeout;
  private initialRun?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly storage: LocalStorageService,
  ) {}

  onModuleInit() {
    // Mesma separação da fila de cobrança: a limpeza é um job, não HTTP.
    if (!runsBackgroundJobs()) return;
    this.initialRun = setTimeout(() => void this.run(), 60_000);
    this.initialRun.unref();
    this.interval = setInterval(() => void this.run(), SIX_HOURS_MS);
    this.interval.unref();
  }

  onApplicationShutdown() {
    if (this.initialRun) clearTimeout(this.initialRun);
    if (this.interval) clearInterval(this.interval);
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    const now = new Date();
    const oldProcessedEvent = new Date(now.getTime() - NINETY_DAYS_MS);
    const oldUsedToken = new Date(now.getTime() - ONE_DAY_MS);
    const oldTemporaryFile = new Date(now.getTime() - ONE_DAY_MS);

    try {
      const [refreshTokens, accountTokens, stripeEvents, temporaryFiles] = await Promise.all([
        this.prisma.refreshToken.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: now } },
              { revokedAt: { not: null, lt: oldUsedToken } },
            ],
          },
        }),
        this.prisma.accountToken.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: now } },
              { usedAt: { not: null, lt: oldUsedToken } },
            ],
          },
        }),
        this.prisma.stripeEvent.deleteMany({
          where: {
            status: "PROCESSADO",
            processedAt: { lt: oldProcessedEvent },
          },
        }),
        this.storage.cleanupTemporaryFiles(oldTemporaryFile),
      ]);

      const total =
        refreshTokens.count + accountTokens.count + stripeEvents.count + temporaryFiles;
      if (total > 0) {
        this.logger.log(
          `Limpeza concluída: ${refreshTokens.count} sessões, ${accountTokens.count} tokens, `
          + `${stripeEvents.count} eventos Stripe e ${temporaryFiles} arquivos temporários.`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "erro desconhecido";
      this.logger.error(`Falha na manutenção automática: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
