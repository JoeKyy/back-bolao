import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { config } from "./common/config";
import { configurarApp } from "./configurar-app";

async function bootstrap() {
  const cfg = config();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configurarApp(app);
  // Escuta só na interface local (no Docker, HOST=0.0.0.0 e a porta é publicada só em 127.0.0.1).
  await app.listen(cfg.porta, process.env.HOST || "127.0.0.1");
  // eslint-disable-next-line no-console
  console.log(`API do bolão em http://localhost:${cfg.porta}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Falha ao subir a API:", err);
  process.exit(1);
});
