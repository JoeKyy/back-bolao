import type { NestExpressApplication } from "@nestjs/platform-express";
import type { PrismaService } from "../src/prisma/prisma.service";
import { cliente, entrarComoAdmin, limpar, subirApp } from "./util";

describe("fluxo completo do bolão", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await subirApp());
    await limpar(prisma);
  });
  afterAll(async () => {
    await app.close();
  });

  it("Virada: inscrição, jogos, Pix, pagamento, registro, resultado e rateio", async () => {
    const adm = await entrarComoAdmin(app);
    const { id } = (await adm.post("/boloes", { nome: "Virada da Firma", tipo: "VIRADA" }).expect(201)).body as { id: number };
    await adm.patch(`/boloes/${id}`, { pixChave: "bolao@exemplo.com", pixNome: "Jhomar Nando", pixCidade: "São Paulo" }).expect(204);

    let r = (await adm.get(`/boloes/${id}`)).body;
    expect(r.bolao.dataSorteio).toBe("2027-01-01T13:00:00.000Z");
    expect(r.bolao.estimativaPremio).toBe(100_000_000_000);
    const conv = r.bolao.convite as string;

    // Ana: um jogo de 6 (R$ 6) e uma surpresinha de 7 (R$ 42)
    const ana = cliente(app);
    expect((await ana.get(`/convites/${conv}`)).body.jaInscrito).toBe(false);
    await ana.post(`/convites/${conv}/inscricao`, { nome: "Ana", whatsapp: "11 91111-1111" }).expect(200);
    expect((await ana.get(`/convites/${conv}`)).body.jaInscrito).toBe(true);
    await ana.post(`/convites/${conv}/jogos`, { dezenas: [5, 12, 23, 34, 45, 60] }).expect(204);
    await ana.post(`/convites/${conv}/jogos`, { dezenas: [1, 2, 3, 4, 7, 8, 9], surpresinha: true }).expect(204);
    // acima do máximo de dezenas do participante (10)
    await ana.post(`/convites/${conv}/jogos`, { dezenas: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }).expect(400);

    let painel = (await ana.get(`/convites/${conv}/painel`)).body;
    expect(painel.eu.devido).toBe(4800);
    expect(painel.eu.situacao).toBe("pendente");
    expect(painel.pix.valor).toBe(4800);
    expect(painel.pix.identificador).toMatch(/^BOL\d+P\d+$/);
    expect(painel.pix.copiaECola).toContain("540548.00");
    expect(painel.jogos.every((j: { participanteId: number }) => j.participanteId === 0)).toBe(true);

    // Beto: um jogo de 6
    const beto = cliente(app);
    await beto.post(`/convites/${conv}/inscricao`, { nome: "Beto" }).expect(200);
    await beto.post(`/convites/${conv}/jogos`, { dezenas: [5, 12, 23, 34, 1, 2] }).expect(204);

    // organizador confirma pagamentos
    r = (await adm.get(`/boloes/${id}`)).body;
    const pAna = r.participantes.find((p: { nome: string }) => p.nome === "Ana").id as number;
    const pBeto = r.participantes.find((p: { nome: string }) => p.nome === "Beto").id as number;
    expect(r.participantes.find((p: { id: number }) => p.id === pAna).whatsapp).toBe("11 91111-1111");
    await adm.post(`/boloes/${id}/participantes/${pAna}/pagamento`, {}).expect(204);
    await adm.post(`/boloes/${id}/participantes/${pBeto}/pagamento`, {}).expect(204);

    painel = (await ana.get(`/convites/${conv}/painel`)).body;
    expect(painel.eu.situacao).toBe("quitado");
    expect(painel.pix).toBeNull();

    // jogo pago não pode ser removido pela participante
    const jogoAna = painel.meusJogos[0].id as number;
    expect((await ana.del(`/convites/${conv}/jogos/${jogoAna}`)).body.codigo).toBe("jogo_pago");

    // registra todos os jogos
    r = (await adm.get(`/boloes/${id}`)).body;
    for (const j of r.jogos) await adm.post(`/boloes/${id}/jogos/${j.id}/registro`, { registrado: true, comprovante: "NSU 123" }).expect(204);

    // resultado manual: Ana faz quina, Beto quadra
    await adm
      .post(`/boloes/${id}/resultado`, { dezenas: [5, 12, 23, 34, 45, 56], premios: { sena: 0, quina: 5_000_000, quadra: 100_000 } })
      .expect(204);
    r = (await adm.get(`/boloes/${id}`)).body;
    expect(r.bolao.inscricoesAbertas).toBe(false);
    expect(r.totais.premioBolao).toBe(5_100_000);
    expect(r.totais.melhorFaixa).toBe("quina");
    const partes = r.participantes.map((p: { parte: number }) => p.parte);
    expect(partes.reduce((s: number, v: number) => s + v, 0)).toBe(5_100_000);
    // pesos 4800 e 600 -> 8/9 e 1/9
    expect(r.participantes.find((p: { id: number }) => p.id === pAna).parte).toBe(4_533_333);
    expect(r.participantes.find((p: { id: number }) => p.id === pBeto).parte).toBe(566_667);

    // BOL-04: mudar pagamento depois do resultado exige confirmação e fica no histórico
    const semConfirmar = await adm.post(`/boloes/${id}/participantes/${pBeto}/pagamento`, { valor: 0 });
    expect(semConfirmar.status).toBe(409);
    await adm.post(`/boloes/${id}/participantes/${pBeto}/pagamento`, { valor: 0, confirmarComResultado: true }).expect(204);
    const eventos = (await adm.get(`/boloes/${id}/eventos`)).body as { tipo: string; descricao: string }[];
    expect(eventos[0].tipo).toBe("pagamento");
    expect(eventos[0].descricao).toContain("Beto");
    expect(eventos.map((e) => e.tipo)).toEqual(
      expect.arrayContaining(["bolao_criado", "inscricao", "jogo_participante", "jogo_registrado", "resultado"]),
    );

    // com resultado, o registro dos jogos fica travado e a inscrição fechada
    await adm.post(`/boloes/${id}/jogos/${jogoAna}/registro`, { registrado: false }).expect(409);
    await cliente(app).post(`/convites/${conv}/inscricao`, { nome: "Tarde" }).expect(409);

    // organizador vê o painel de participante sem ser participante
    const visao = (await adm.get(`/convites/${conv}/painel`)).body;
    expect(visao.visaoOrganizador).toBe(true);
    expect(visao.eu).toBeNull();
  });

  it("excluir bolão exige o nome exato", async () => {
    const adm = await entrarComoAdmin(app);
    const { id } = (await adm.post("/boloes", { nome: "Apagar", tipo: "NORMAL", dataSorteio: "2099-01-01T13:00:00.000Z" })).body as { id: number };
    await adm.post(`/boloes/${id}/excluir`, { confirmacao: "apagar" }).expect(400);
    await adm.post(`/boloes/${id}/excluir`, { confirmacao: "Apagar" }).expect(204);
    await adm.get(`/boloes/${id}`).expect(404);
  });

  it("chave Pix inválida é recusada", async () => {
    const adm = await entrarComoAdmin(app);
    const { id } = (await adm.post("/boloes", { nome: "Pix", tipo: "NORMAL", dataSorteio: "2099-01-01T13:00:00.000Z" })).body as { id: number };
    const r = await adm.patch(`/boloes/${id}`, { pixChave: "não é chave" });
    expect(r.status).toBe(400);
    expect(r.body.codigo).toBe("pix_invalido");
  });
});
