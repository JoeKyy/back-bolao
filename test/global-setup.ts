import { execSync } from "node:child_process";
import path from "node:path";

/** Aplica as migrações no banco de teste. A limpeza das tabelas é feita por cada suíte. */
export default function globalSetup() {
  require("./env");
  const url = process.env.DATABASE_URL!;
  if (!/\/bolao_teste[a-z_]*(\?|$)/.test(url)) throw new Error("Os testes e2e só rodam no banco bolao_teste.");
  execSync("npx prisma migrate deploy", { cwd: path.join(__dirname, ".."), env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
}
