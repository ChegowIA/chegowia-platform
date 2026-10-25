import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { OutreachWorkerModule } from "./outreach-worker.module";

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
