import { crc16, gerarPix, limparTexto, normalizarChave } from "./pix";

describe("pix", () => {
  it("CRC16 confere com o valor de referência CCITT-FALSE", () => {
    // "123456789" -> 0x29B1 é o vetor de teste padrão do CRC-16/CCITT-FALSE.
    expect(crc16("123456789")).toBe("29B1");
  });

  it("gera payload com campos na ordem e CRC válido", () => {
    const p = gerarPix({
      chave: "bolao@exemplo.com",
      nome: "Jhomar Nando",
      cidade: "São Paulo",
      valor: 4200,
      identificador: "BOL1P23",
    });
    expect(p.startsWith("000201")).toBe(true);
    expect(p).toContain("0014br.gov.bcb.pix0117bolao@exemplo.com");
    expect(p).toContain("540542.00");
    expect(p).toContain("5802BR");
    expect(p).toContain("5912Jhomar Nando");
    expect(p).toContain("6009Sao Paulo");
    expect(p).toContain("62110507BOL1P23");
    const semCrc = p.slice(0, -4);
    expect(p.slice(-4)).toBe(crc16(semCrc));
  });

  it("identificador só alfanumérico e no máximo 25", () => {
    const p = gerarPix({ chave: "a@b.co", nome: "X", cidade: "Y", valor: 0, identificador: "BOL-1/P 2!" + "9".repeat(40) });
    const m = /62(\d{2})05(\d{2})([A-Za-z0-9]+)6304/.exec(p);
    expect(m?.[3].length).toBeLessThanOrEqual(25);
    expect(m?.[3].startsWith("BOL1P2")).toBe(true);
  });

  it("sem valor, não inclui o campo 54", () => {
    expect(gerarPix({ chave: "a@b.co", nome: "X", cidade: "Y", valor: 0, identificador: "A" })).not.toContain("5404");
  });

  it("limpa acentos e caracteres de controle", () => {
    expect(limparTexto("João\u0000 Ação", 25)).toBe("Joao Acao");
  });

  it("normaliza e valida chaves", () => {
    expect(normalizarChave("Bolao@Exemplo.com")).toEqual({ chave: "bolao@exemplo.com", tipo: "email" });
    expect(normalizarChave("123.456.789-09")).toEqual({ chave: "12345678909", tipo: "cpf" });
    expect(normalizarChave("12.345.678/0001-90")).toEqual({ chave: "12345678000190", tipo: "cnpj" });
    expect(normalizarChave("+55 (11) 91234-5678")).toEqual({ chave: "+5511912345678", tipo: "telefone" });
    expect(normalizarChave("123e4567-e89b-12d3-a456-426614174000")?.tipo).toBe("aleatoria");
    expect(normalizarChave("qualquer coisa")).toBeNull();
    expect(normalizarChave("<script>")).toBeNull();
  });
});
