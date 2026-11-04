// RVAL-06: busca explícita do organizador ignora o cache de 10 min (com intervalo mínimo de 30 s).
process.env.CAIXA_API_URL = "http://caixa.teste/api";

import { CaixaService } from "./caixa.service";

const resposta = (premio: number) => ({
  numero: 3080,
  dataApuracao: "01/11/2026",
  listaDezenas: ["13", "17", "28", "29", "39", "58"],
  listaRateioPremio: [
    { faixa: 1, numeroDeGanhadores: 0, valorPremio: 0 },
    { faixa: 2, numeroDeGanhadores: 29, valorPremio: premio },
    { faixa: 3, numeroDeGanhadores: 3133, valorPremio: premio ? 514.1 : 0 },
  ],
});

describe("CaixaService: cache e busca explícita", () => {
  let chamadas = 0;
  let premio = 0;
  const original = global.fetch;
  beforeEach(() => {
    chamadas = 0;
    premio = 0;
    global.fetch = (async () => {
      chamadas++;
      return new Response(JSON.stringify(resposta(premio)), { status: 200 });
    }) as typeof fetch;
  });
  afterAll(() => {
    global.fetch = original;
    jest.restoreAllMocks();
  });

  it("consulta normal usa o cache; busca explícita depois de 30 s enxerga o rateio publicado", async () => {
    const svc = new CaixaService();
    const agora = Date.now();
    const relogio = jest.spyOn(Date, "now").mockReturnValue(agora);
    expect((await svc.concurso(3080))!.premios.quina).toBe(0); // resultado ainda sem rateio
    await svc.concurso(3080);
    expect(chamadas).toBe(1); // cache

    premio = 38878.66; // a Caixa publicou o rateio
    expect((await svc.concurso(3080, true))!.premios.quina).toBe(0); // menos de 30 s: ainda cache
    expect(chamadas).toBe(1);

    relogio.mockReturnValue(agora + 31_000);
    expect((await svc.concurso(3080, true))!.premios.quina).toBe(3887866); // busca nova
    expect(chamadas).toBe(2);
  });
});
