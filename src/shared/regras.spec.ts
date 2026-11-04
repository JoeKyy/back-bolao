import {
  chanceSena,
  comb,
  conferir,
  melhorFaixa,
  parseDezenas,
  parseReais,
  precoJogo,
  ratear,
  surpresinha,
  validarDezenas,
} from "./regras";
import crypto from "node:crypto";

describe("parseDezenas", () => {
  it("aceita separadores variados e ordena", () => {
    expect(parseDezenas("10 3-25,60 1 44")).toEqual({ ok: true, dezenas: [1, 3, 10, 25, 44, 60] });
  });
  it("recusa fora da faixa, repetidas e quantidade errada", () => {
    expect(parseDezenas("0 1 2 3 4 5").ok).toBe(false);
    expect(parseDezenas("1 2 3 4 5 61").ok).toBe(false);
    expect(parseDezenas("1 1 2 3 4 5").ok).toBe(false);
    expect(parseDezenas("1 2 3 4 5").ok).toBe(false);
    expect(parseDezenas(Array.from({ length: 21 }, (_, i) => i + 1).join(" ")).ok).toBe(false);
  });
  it("respeita min e max", () => {
    expect(parseDezenas("1 2 3 4 5 6 7", { min: 6, max: 6 }).ok).toBe(false);
  });
  it("validarDezenas recusa não inteiros", () => {
    expect(validarDezenas([1, 2, 3, 4, 5, 6.5]).ok).toBe(false);
  });
});

describe("preço e combinações", () => {
  it("C(n,k)", () => {
    expect(comb(60, 6)).toBe(50_063_860);
    expect(comb(20, 6)).toBe(38_760);
  });
  it("tabela da Caixa com aposta a R$ 6", () => {
    expect([6, 7, 8, 9, 10, 15, 20].map((k) => precoJogo(k, 600))).toEqual([
      600, 4200, 16800, 50400, 126000, 3003000, 23256000,
    ]);
  });
});

describe("conferir", () => {
  const s = [5, 12, 23, 34, 45, 56];
  it("jogo simples", () => {
    expect(conferir([5, 12, 23, 34, 45, 56], s).faixa).toBe("sena");
    expect(conferir([5, 12, 23, 34, 45, 1], s)).toMatchObject({ senas: 0, quinas: 1, quadras: 0, faixa: "quina" });
    expect(conferir([5, 12, 23, 34, 1, 2], s)).toMatchObject({ quadras: 1, faixa: "quadra" });
    expect(conferir([5, 12, 23, 1, 2, 3], s).faixa).toBeNull();
  });
  it("jogo de 7 dezenas com a sena: 1 sena e 6 quinas", () => {
    expect(conferir([5, 12, 23, 34, 45, 56, 1], s)).toMatchObject({ senas: 1, quinas: 6, quadras: 0 });
  });
  it("jogo de 8 dezenas com 5 acertos: 3 quinas e 15 quadras", () => {
    expect(conferir([5, 12, 23, 34, 45, 1, 2, 3], s)).toMatchObject({ senas: 0, quinas: 3, quadras: 15 });
  });
  it("melhor faixa", () => {
    expect(melhorFaixa([conferir([5, 12, 23, 34, 1, 2], s), conferir([5, 12, 23, 34, 45, 1], s)])).toBe("quina");
    expect(melhorFaixa([])).toBeNull();
  });
});

describe("ratear", () => {
  it("soma exata, maior resto, desempate pelo menor id", () => {
    const r = ratear(100, [
      { id: 1, peso: 1 },
      { id: 2, peso: 1 },
      { id: 3, peso: 1 },
    ]);
    expect([...r.values()]).toEqual([34, 33, 33]);
  });
  it("peso zero não recebe", () => {
    const r = ratear(1000, [
      { id: 1, peso: 0 },
      { id: 2, peso: 600 },
    ]);
    expect(r.get(1)).toBe(0);
    expect(r.get(2)).toBe(1000);
  });
  it("sem prêmio ou sem peso, todos zero", () => {
    expect([...ratear(0, [{ id: 1, peso: 5 }]).values()]).toEqual([0]);
    expect([...ratear(500, [{ id: 1, peso: 0 }]).values()]).toEqual([0]);
  });
  it("R$ 1 bilhão entre pesos grandes fecha no centavo", () => {
    const itens = Array.from({ length: 97 }, (_, i) => ({ id: i + 1, peso: 600 * (i + 1) + 7 }));
    const r = ratear(100_000_000_000, itens);
    expect([...r.values()].reduce((s, v) => s + v, 0)).toBe(100_000_000_000);
  });
});

describe("surpresinha", () => {
  const rnd = (n: number) => crypto.randomInt(n);
  it("gera k dezenas distintas válidas e ordenadas", () => {
    for (let k = 6; k <= 20; k++) {
      const d = surpresinha(k, rnd);
      expect(validarDezenas(d, { min: k, max: k })).toEqual({ ok: true, dezenas: d });
    }
  });
  it("recusa k inválido", () => {
    expect(() => surpresinha(5, rnd)).toThrow();
    expect(() => surpresinha(21, rnd)).toThrow();
  });
  it("cobre todas as dezenas em muitas rodadas (sem viés grosseiro)", () => {
    const vistos = new Set<number>();
    for (let i = 0; i < 300; i++) surpresinha(6, rnd).forEach((n) => vistos.add(n));
    expect(vistos.size).toBe(60);
  });
});

describe("chanceSena e parseReais", () => {
  it("chance", () => {
    expect(chanceSena([])).toEqual({ apostas: 0, umEm: null });
    expect(chanceSena([[1, 2, 3, 4, 5, 6]]).umEm).toBe(50_063_860);
  });
  it("reais", () => {
    expect(parseReais("1.234,56")).toBe(123456);
    expect(parseReais("R$ 10")).toBe(1000);
    expect(parseReais("12.5")).toBe(1250);
    expect(parseReais("abc")).toBeNull();
  });
});
