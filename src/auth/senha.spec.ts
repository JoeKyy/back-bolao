import { HttpException } from "@nestjs/common";
import { exigirSenhaAceitavel } from "./senha";

const codigo = (f: () => void) => {
  try {
    f();
    return null;
  } catch (e) {
    return ((e as HttpException).getResponse() as { codigo: string }).codigo;
  }
};

describe("política de senha (esquema do gestor)", () => {
  it.each([
    ["curta", "curta123", "senha_curta"],
    ["comum", "123456789012", "senha_comum"],
    ["palavra fraca + ano", "MegaDaVirada2026!", "senha_comum"],
    ["bolão + números", "Bolão@20262026", "senha_comum"],
    ["repetição", "abcabcabcabc", "senha_comum"],
    ["sequência", "abcdefghijkl", "senha_comum"],
  ])("recusa %s", (_n, senha, esperado) => {
    expect(codigo(() => exigirSenhaAceitavel(senha))).toBe(esperado);
  });

  it("recusa o próprio nome ou e-mail", () => {
    expect(codigo(() => exigirSenhaAceitavel("Jhomarnando2026", { nome: "Jhomar Nando" }))).toBe("senha_pessoal");
    expect(codigo(() => exigirSenhaAceitavel("joekyyteste99", { email: "joekyyteste@exemplo.com" }))).toBe("senha_pessoal");
  });

  it("aceita senha boa", () => {
    expect(codigo(() => exigirSenhaAceitavel("cavalo-azul-bateria-grampo", { nome: "Bia", email: "bia@x.com" }))).toBeNull();
  });
});
