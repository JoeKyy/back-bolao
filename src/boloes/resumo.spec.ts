import { montarResumo, situacaoDe, type JogoBase, type ParticipanteBase } from "./resumo";

const P = (id: number, valorPago: number): ParticipanteBase => ({
  id,
  nome: `P${id}`,
  whatsapp: "",
  valorPago,
  criadoEm: new Date("2026-11-01T00:00:00Z"),
});
let seq = 0;
const J = (participanteId: number, dezenas: number[], registrado = true): JogoBase => ({
  id: ++seq,
  participanteId,
  dezenas,
  surpresinha: false,
  registrado,
  comprovante: null,
});

describe("situacaoDe", () => {
  it("classifica", () => {
    expect(situacaoDe(600, 600)).toBe("quitado");
    expect(situacaoDe(600, 900)).toBe("quitado");
    expect(situacaoDe(4200, 600)).toBe("parcial");
    expect(situacaoDe(600, 0)).toBe("pendente");
    expect(situacaoDe(0, 0)).toBe("pendente");
  });
});

describe("montarResumo", () => {
  const sorteadas = [5, 12, 23, 34, 45, 56];
  const premios = { sena: 100_000_000_000, quina: 5_000_000, quadra: 100_000 }; // R$ 1 bi, 50 mil, 1 mil

  it("preço por quantidade de dezenas e devido por participante", () => {
    const r = montarResumo({ precoSimples: 600, resultadoDezenas: [], premios: null }, [P(1, 0)], [
      J(1, [1, 2, 3, 4, 5, 6]),
      J(1, [1, 2, 3, 4, 5, 6, 7]),
    ]);
    expect(r.jogos.map((j) => j.preco)).toEqual([600, 4200]);
    expect(r.participantes[0].devido).toBe(4800);
    expect(r.totais.premioBolao).toBeNull();
    expect(r.jogos[0].conferencia).toBeNull();
  });

  it("só jogo registrado é conferido; prêmio por faixa; rateio pelo peso pago", () => {
    const parts = [P(1, 600), P(2, 1200), P(3, 0)];
    const jogos = [
      J(1, [5, 12, 23, 34, 45, 60]), // quina, registrado
      J(2, [5, 12, 23, 34, 1, 2]), // quadra, registrado
      J(2, [5, 12, 23, 34, 45, 56], false), // seria sena, mas NÃO registrado
      J(3, [7, 8, 9, 10, 11, 13]),
    ];
    const r = montarResumo({ precoSimples: 600, resultadoDezenas: sorteadas, premios }, parts, jogos);
    expect(r.jogos[2].conferencia).toBeNull();
    expect(r.totais.premioBolao).toBe(5_000_000 + 100_000);
    expect(r.totais.melhorFaixa).toBe("quina");
    // pesos: P1 = min(600, 600) = 600; P2 = min(1200, 1200) = 1200; P3 = 0
    expect(r.totais.pesoTotal).toBe(1800);
    const partes = r.participantes.map((p) => p.parte);
    expect(partes).toEqual([1_700_000, 3_400_000, 0]);
    expect(partes.reduce<number>((s, v) => s + (v ?? 0), 0)).toBe(r.totais.premioBolao);
  });

  it("sena de R$ 1 bi com pesos grandes não perde centavo (BigInt)", () => {
    const parts = [P(1, 1_000_000), P(2, 333_333), P(3, 777_777)];
    const jogos = [J(1, [5, 12, 23, 34, 45, 56]), J(2, [1, 2, 3, 4, 7, 8]), J(3, [9, 10, 11, 13, 14, 15])];
    // Ajusta preços: cada um paga mais do que deve, então peso = devido = 600.
    const r = montarResumo({ precoSimples: 600, resultadoDezenas: sorteadas, premios }, parts, jogos);
    const soma = r.participantes.reduce((s, p) => s + (p.parte ?? 0), 0);
    expect(r.totais.premioBolao).toBe(100_000_000_000);
    expect(soma).toBe(100_000_000_000);
  });

  it("chance conta só jogos de quem pagou", () => {
    const r = montarResumo({ precoSimples: 600, resultadoDezenas: [], premios: null }, [P(1, 4200), P(2, 0)], [
      J(1, [1, 2, 3, 4, 5, 6, 7]),
      J(2, [1, 2, 3, 4, 5, 6]),
    ]);
    expect(r.chance.apostas).toBe(7);
    expect(r.chance.umEm).toBe(Math.round(50_063_860 / 7));
  });
});
