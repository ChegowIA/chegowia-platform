import "reflect-metadata";
import { join, resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { BadRequestException, Logger, ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import compression from "compression";
import helmet from "helmet";
import * as express from "express";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { validationMessages } from "./common/validation/validation-errors";
import { appRole } from "./common/config/app-role";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: false,
    rawBody: true,
  });
  const logger = new Logger("Bootstrap");
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));

  app.use(cookieParser());
  app.use(compression());
  // Endpoints da API carregam dados operacionais e de sessão. Eles não devem
  // ser revalidados pelo navegador como se fossem assets: após um deploy ou
  // reinício isso poderia reutilizar uma resposta 304 sem o estado atual.
  // Arquivos públicos em /uploads continuam com sua própria política de cache.
  app.use((request, response, next) => {
    // `originalUrl` preserva o prefixo global do Nest antes do roteamento.
    // Assim a regra continua correta mesmo se algum middleware normalizar
    // `request.path` internamente.
    if ((request.originalUrl ?? request.path).startsWith("/api/")) {
      response.setHeader("Cache-Control", "private, no-store, max-age=0");
      response.setHeader("Pragma", "no-cache");
    }
    next();
  });
  /**
   * CSP explícita em vez do padrão do helmet.
   *
   * O padrão inclui `script-src 'self'`, o que é bom, mas também permite
   * `form-action`, `frame-ancestors` e `connect-src` amplos. Esta API serve
   * JSON, uploads públicos e o DANFE (HTML de cupom) — nada mais. Fechar tudo
   * o que ela não usa reduz o que um XSS refletido conseguiria fazer.
   *
   * `frame-ancestors 'none'` é o que impede a API de ser embutida num iframe
   * de terceiro; `form-action 'none'` impede que conteúdo injetado poste dados
   * para fora.
   */
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        // O DANFE é HTML autocontido com CSS inline; nenhum script.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        scriptSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
        ...(process.env.NODE_ENV === "production" ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // O Swagger em desenvolvimento precisa de script inline; ele só sobe fora
    // de produção (ou com ENABLE_SWAGGER explícito), então a exceção fica
    // restrita à própria rota, mais abaixo.
  }));
  app.useBodyParser("json", { limit: process.env.JSON_BODY_LIMIT ?? "1mb" });
  app.useBodyParser("urlencoded", {
    limit: process.env.FORM_BODY_LIMIT ?? "1mb",
    extended: true,
  });

  const uploadRoot = process.env.UPLOAD_ROOT
    ? resolve(process.env.UPLOAD_ROOT)
    : join(process.cwd(), "uploads");
  app.use("/uploads", express.static(uploadRoot, {
    dotfiles: "deny",
    index: false,
    maxAge: process.env.NODE_ENV === "production" ? "7d" : 0,
  }));

  const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  app.enableCors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin.replace(/\/+$/, ""))) {
        callback(null, true);
        return;
      }
      callback(new Error("Origem não autorizada pelo CORS."));
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
    maxAge: 86_400,
  });
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
      exceptionFactory: (errors) => new BadRequestException({
        message: validationMessages(errors).join(" "),
      }),
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  if (process.env.NODE_ENV !== "production" || process.env.ENABLE_SWAGGER === "true") {
    // A CSP global bloqueia script; o Swagger UI depende de script inline.
    // A exceção é aplicada só nesta rota, em vez de afrouxar a política toda.
    app.use("/api/docs", helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
        },
      },
    }));
    const config = new DocumentBuilder()
      .setTitle("ChegowIA API")
      .setDescription(
        "API da plataforma SaaS multiempresa de pedidos/delivery com agente de IA",
      )
      .setVersion("0.1.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api/docs", app, document);
  }

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  app.enableShutdownHooks();
  await app.listen(port, process.env.HOST ?? "0.0.0.0");
  // O papel do processo decide se os jobs em segundo plano sobem aqui; o worker
  // continua servindo HTTP na rede interna só para o health check do compose.
  logger.log(`ChegowIA API disponível na porta ${port} (APP_ROLE=${appRole()})`);
}
bootstrap().catch((error) => {
  const logger = new Logger("Bootstrap");
  logger.error("Falha ao iniciar a API.", error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
