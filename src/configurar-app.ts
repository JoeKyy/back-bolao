import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { config } from "./common/config";
import { FiltroErros } from "./common/filtro-erros";
import { CABECALHO_CSRF, protecaoCsrf, semCache } from "./common/seguranca.middleware";

/** Configuração compartilhada entre o main.ts e os testes e2e (a mesma app nos dois). */
export function configurarApp(app: NestExpressApplication) {
  const cfg = config();
  // BOL-01: só confia em X-Forwarded-For vindo do proxy definido (ex.: "loopback" no CloudPanel).
  // Sem TRUST_PROXY, req.ip é o IP da conexão e o cabeçalho é ignorado.
  app.set("trust proxy", cfg.trustProxy);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: "same-site" },
      referrerPolicy: { policy: "no-referrer" },
      hsts: cfg.producao ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );
  app.use(cookieParser());
  app.useBodyParser("json", { limit: "64kb" });
  app.use(semCache);
  app.enableCors({
    origin: cfg.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", CABECALHO_CSRF],
    maxAge: 600,
  });
  app.use(protecaoCsrf(cfg.corsOrigins));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new FiltroErros());
  app.enableShutdownHooks();
}
