import { crc16, gerarPix, limparTexto, normalizarChave } from "./pix";

/** Percorre o BR Code campo a campo (id, tamanho, valor) até o fim; falha se algo não fechar. */
function lerEmv(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2);
    const n = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || !Number.isInteger(n)) throw new Error(`EMV inválido em ${i}`);
    out[id] = s.slice(i + 4, i + 4 + n);
    i += 4 + n;
  }
  if (i !== s.length) throw new Error("EMV não fecha");
  return out;
}

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

  it("SEC-03: chave aleatória + nome longo não estoura o campo 26", () => {
    const p = gerarPix({
      chave: "123e4567-e89b-12d3-a456-426614174000",
      nome: "Organizador",
      cidade: "Sao Paulo",
      valor: 126000,
      identificador: "BOL4P2",
      descricao: "Bolao Teste Auditoria Rateio Tardio Grupo Grande e Mais Coisa",
    });
    const campos = lerEmv(p);
    expect(campos["26"].length).toBeLessThanOrEqual(99);
    expect(lerEmv(campos["26"])["01"]).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });

  it("SEC-03: e-mail de 77 caracteres e descrição de 80 continuam válidos", () => {
    const email = `${"a".repeat(64)}@exemplo.com`.slice(0, 77);
    const p = gerarPix({ chave: email, nome: "N".repeat(40), cidade: "C".repeat(30), valor: 600, identificador: "X", descricao: "D".repeat(80) });
    const campos = lerEmv(p);
    for (const v of Object.values(campos)) expect(v.length).toBeLessThanOrEqual(99);
    expect(campos["59"]).toHaveLength(25);
    expect(campos["60"]).toHaveLength(15);
  });

  it("SEC-03: e-mail com acento é recusado", () => {
    expect(normalizarChave("joão@exemplo.com")).toBeNull();
  });
});
