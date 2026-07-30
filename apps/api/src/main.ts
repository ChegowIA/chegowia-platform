import "reflect-metadata";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import * as express from "express";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });

  app.use(cookieParser());
  app.use("/uploads", express.static(join(process.cwd(), "uploads")));
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(",") ?? "http://localhost:3000",
    credentials: true,
  });
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

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

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`ChegowIA API rodando em http://localhost:${port}/api`);
}
bootstrap();
