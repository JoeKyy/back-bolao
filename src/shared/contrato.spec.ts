import { execFileSync } from "node:child_process";
import path from "node:path";

describe("contrato com o front", () => {
  it("contrato.json bate com regras.ts e tipos.ts", () => {
    expect(() =>
      execFileSync("node", ["scripts/gerar-contrato.mjs", "--conferir"], { cwd: path.join(__dirname, "..", ".."), stdio: "pipe" }),
    ).not.toThrow();
  });
});
