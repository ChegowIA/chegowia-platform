import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { OutreachWorkerModule } from "./outreach-worker.module";

/**
 * A libsignal (dentro do Baileys) escreve no console as sessões inteiras,
 * com chaves privadas. Isso não pode ir para o log do provedor.
 * O Logger do Nest escreve direto no stdout e não passa por aqui.
 */
const RUIDO_DA_LIBSIGNAL = /^(Closing session|Opening session|Closing open session|Session already|Failed to decrypt|Session error|Migrating session|V1 session storage|Unhandled bucket type)/;
for (const nivel of ["log", "info", "warn", "error"] as const) {
  const original = console[nivel].bind(console);
  console[nivel] = (...args: unknown[]) => {
    if (typeof args[0] === "string" && RUIDO_DA_LIBSIGNAL.test(args[0])) return;
    original(...args);
  };
}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(OutreachWorkerModule);
  app.enableShutdownHooks();
  new Logger("OutreachWorker").log("Worker de prospecção iniciado, sem servidor HTTP.");
}

bootstrap().catch((error) => {
  new Logger("OutreachWorker").error(
    "Falha ao iniciar o worker de prospecção.",
    error instanceof Error ? error.stack : String(error),
  );
  // Os timers da fila mantêm o processo vivo. Boot incompleto deve falhar
  // imediatamente para que o orquestrador reinicie após o banco voltar.
  process.exit(1);
});
