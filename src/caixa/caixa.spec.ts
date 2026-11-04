import { lerComLimite, lerConcursoCaixa } from "./caixa.service";

// Recorte real da resposta de servicebus2.caixa.gov.br (concurso 3080, 01/11/2026).
const REAL = {
  acumulado: true,
  dataApuracao: "01/11/2026",
  dataProximoConcurso: "04/11/2026",
  listaDezenas: ["13", "17", "28", "29", "39", "58"],
  listaRateioPremio: [
    { descricaoFaixa: "6 acertos", faixa: 1, numeroDeGanhadores: 0, valorPremio: 0.0 },
    { descricaoFaixa: "5 acertos", faixa: 2, numeroDeGanhadores: 29, valorPremio: 38878.66 },
    { descricaoFaixa: "4 acertos", faixa: 3, numeroDeGanhadores: 3133, valorPremio: 514.1 },
  ],
  numero: 3080,
  numeroConcursoProximo: 3081,
  valorAcumuladoConcursoEspecial: 141523480.87,
  valorEstimadoProximoConcurso: 46000000.0,
};

describe("lerConcursoCaixa", () => {
  it("converte a resposta real", () => {
    expect(lerConcursoCaixa(REAL)).toEqual({
      numero: 3080,
      data: "01/11/2026",
      dezenas: [13, 17, 28, 29, 39, 58],
      premios: { sena: 0, quina: 3887866, quadra: 51410 },
      ganhadores: { sena: 0, quina: 29, quadra: 3133 },
      acumulou: true,
      proximoConcurso: 3081,
      dataProximo: "04/11/2026",
      estimativaProximo: 4600000000,
      acumuladoVirada: 14152348087,
    });
  });

  it("recusa formato inesperado", () => {
    expect(lerConcursoCaixa(null)).toBeNull();
    expect(lerConcursoCaixa({ numero: 1, listaDezenas: ["1", "2"] })).toBeNull();
    expect(lerConcursoCaixa({ ...REAL, listaDezenas: ["1", "2", "3", "4", "5", "99"] })).toBeNull();
    expect(lerConcursoCaixa({ ...REAL, numero: "3080" })).toBeNull();
  });

  it("faixa com valor estranho vira zero, não NaN", () => {
    const r = lerConcursoCaixa({ ...REAL, listaRateioPremio: [{ faixa: 2, valorPremio: "muito" }] });
    expect(r?.premios).toEqual({ sena: 0, quina: 0, quadra: 0 });
  });

  it("SEC-09: prêmio absurdo (1e300) invalida o resultado inteiro", () => {
    const hostil = { ...REAL, listaRateioPremio: [{ faixa: 1, numeroDeGanhadores: 1, valorPremio: 1e300 }] };
    expect(lerConcursoCaixa(hostil)).toBeNull();
  });
});

describe("lerComLimite", () => {
  it("SEC-09: aborta resposta de 1 MB sem content-length", async () => {
    const grande = new Response(new ReadableStream({
      start(c) {
        for (let i = 0; i < 16; i++) c.enqueue(new Uint8Array(65_536));
        c.close();
      },
    }));
    await expect(lerComLimite(grande)).rejects.toThrow("grande demais");
  });
  it("recusa pelo content-length declarado", async () => {
    const r = new Response("{}", { headers: { "content-length": "999999" } });
    await expect(lerComLimite(r)).rejects.toThrow("grande demais");
  });
  it("lê resposta pequena", async () => {
    expect(await lerComLimite(new Response('{"a":1}'))).toBe('{"a":1}');
  });
});
