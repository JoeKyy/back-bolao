// Ambiente dos testes e2e. Banco separado (bolao_teste); nunca o de desenvolvimento.
import fs from "node:fs";
import path from "node:path";

function urlDeTeste(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
  const m = /^DATABASE_URL=(.+)$/m.exec(env);
  if (!m) throw new Error("Defina TEST_DATABASE_URL ou DATABASE_URL no .env");
  return m[1].trim().replace(/\/bolao(\?|$)/, "/bolao_teste$1");
}

process.env.DATABASE_URL = urlDeTeste();
process.env.NODE_ENV = "test";
process.env.CORS_ORIGINS = "http://front.teste";
process.env.ADMIN_EMAIL = "admin@teste.local";
process.env.ADMIN_PASSWORD = "senha-de-teste-123";
process.env.TRUST_PROXY = "";
process.env.CAIXA_API_URL = "";
