// Impressão digital dos arquivos compartilhados com o front (regras.ts e tipos.ts).
// Os dois repositórios rodam este mesmo script; o deploy compara os dois contrato.json.
// Uso: node scripts/gerar-contrato.mjs [--conferir]
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = process.env.CONTRATO_DIR ?? "src/shared";
const arquivos = ["regras.ts", "tipos.ts"];
const normalizar = (t) => t.replace(/\r\n/g, "\n").trimEnd() + "\n";
const contrato = Object.fromEntries(
  arquivos.map((a) => [a, crypto.createHash("sha256").update(normalizar(fs.readFileSync(path.join(dir, a), "utf8"))).digest("hex")]),
);
const saida = path.join(dir, "contrato.json");
const texto = JSON.stringify(contrato, null, 2) + "\n";
if (process.argv.includes("--conferir")) {
  const atual = fs.existsSync(saida) ? fs.readFileSync(saida, "utf8") : "";
  if (atual !== texto) {
    console.error("contrato.json desatualizado: rode `pnpm contrato:gerar` e copie os arquivos compartilhados para o outro repositório.");
    process.exit(1);
  }
  console.log("contrato ok");
} else {
  fs.writeFileSync(saida, texto);
  console.log(texto);
}
