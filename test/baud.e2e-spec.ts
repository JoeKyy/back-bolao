// Testes dos achados da auditoria completa de 04/11/2026 (BAUD-01 a BAUD-11).
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";
import { lerComLimite } from "../src/caixa/caixa.service";
import { ORIGEM, cliente, entrarComoAdmin, limpar, login, subirApp } from "./util";

describe("auditoria completa (BAUD)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const DATA = "2099-01-01T13:00:00.000Z";

  beforeAll(async () => {
    ({ app, prisma } = await subirApp());
  });
  beforeEach(async () => {
    await limpar(prisma);
  });
  afterAll(async () => {
    await app.close();
  });
  void lerComLimite;

  async function novaConta(email: string, nome: string, perfis: { admin?: boolean; tesoureiro?: boolean } = { tesoureiro: true }) {
    const adm = await entrarComoAdmin(app);
    const { token } = (await adm.post("/usuarios", { email, nome, ...perfis }).expect(201)).body as { token: string };
    const c = cliente(app);
    await c.post(`/convite-organizador/${token}`, { nome, senha: "senha-da-organizadora-1" }).expect(200);
    return c;
  }

  it("BAUD-06: a lista agrega no banco e devolve os mesmos números do resumo", async () => {
    const adm = await entrarComoAdmin(app);
    const { id } = (await adm.post("/boloes", { nome: "Lista", tipo: "NORMAL", dataSorteio: DATA }).expect(201)).body as { id: number };
    const conv = (await adm.get(`/boloes/${id}`)).body.bolao.convite as string;
    const ana = cliente(app);
    await ana.post(`/convites/${conv}/inscricao`, { nome: "Ana" }).expect(200);
    await ana.post(`/convites/${conv}/jogos`, { dezenas: [1, 2, 3, 4, 5, 6] }).expect(204);
    await ana.post(`/convites/${conv}/jogos`, { dezenas: [1, 2, 3, 4, 5, 6, 7] }).expect(204);
    const beto = cliente(app);
    await beto.post(`/convites/${conv}/inscricao`, { nome: "Beto" }).expect(200);
    await beto.post(`/convites/${conv}/jogos`, { dezenas: [7, 8, 9, 10, 11, 12] }).expect(204);
    const r = (await adm.get(`/boloes/${id}`)).body;
    const pAna = r.participantes.find((p: { nome: string }) => p.nome === "Ana").id as number;
    await adm.post(`/boloes/${id}/participantes/${pAna}/pagamento`, {}).expect(204);
    const lista = (await adm.get("/boloes").expect(200)).body as Record<string, unknown>[];
    const resumo = (await adm.get(`/boloes/${id}`)).body;
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({
      participantes: 2,
      quitados: resumo.participantes.filter((p: { situacao: string }) => p.situacao === "quitado").length,
      arrecadado: resumo.totais.arrecadado,
      jogos: 3,
      temResultado: false,
      inscricoesAbertas: true,
    });
    expect(lista[0].quitados).toBe(1);
    expect(lista[0].arrecadado).toBe(4800);
  });

  describe("BAUD-03: concurso normal exige data do sorteio", () => {
    it("criar sem data dá 400; com data trava depois do horário", async () => {
      const adm = await entrarComoAdmin(app);
      const r = await adm.post("/boloes", { nome: "Sem data", tipo: "NORMAL", concurso: 3080 });
      expect(r.status).toBe(400);
      expect(r.body.codigo).toBe("data_obrigatoria");
      await adm.post("/boloes", { nome: "Data ruim", tipo: "NORMAL", dataSorteio: "ontem" }).expect(400);
      await adm.post("/boloes", { nome: "Virada", tipo: "VIRADA" }).expect(201); // a Virada usa a data fixa
    });

    it("bolão sem data (legado) não aceita inscrição", async () => {
      const adm = await entrarComoAdmin(app);
      const { id } = (await adm.post("/boloes", { nome: "Legado", tipo: "NORMAL", dataSorteio: DATA })).body as { id: number };
      const conv = (await adm.get(`/boloes/${id}`)).body.bolao.convite as string;
      await prisma.bolao.update({ where: { id }, data: { dataSorteio: null } });
      expect((await cliente(app).post(`/convites/${conv}/inscricao`, { nome: "Tarde" })).status).toBe(409);
    });
  });

  describe("BAUD-04: resultado já lançado não é sobrescrito nem apagado sem confirmar", () => {
    it("sobrescrever e apagar dão 409 sem ?confirmar=1", async () => {
      const adm = await entrarComoAdmin(app);
      const { id } = (await adm.post("/boloes", { nome: "Resultado", tipo: "NORMAL", dataSorteio: DATA })).body as { id: number };
      const corpo = { dezenas: [1, 2, 3, 4, 5, 6], premios: { sena: 0, quina: 0, quadra: 0 } };
      await adm.post(`/boloes/${id}/resultado`, corpo).expect(204); // primeiro lançamento: livre
      expect((await adm.post(`/boloes/${id}/resultado`, corpo)).body.codigo).toBe("bolao_travado");
      expect((await adm.del(`/boloes/${id}/resultado`)).body.codigo).toBe("bolao_travado");
      await adm.post(`/boloes/${id}/resultado?confirmar=1`, corpo).expect(204);
      await adm.del(`/boloes/${id}/resultado?confirmar=1`).expect(204);
      const tipos = ((await adm.get(`/boloes/${id}/eventos`)).body as { tipo: string }[]).map((e) => e.tipo);
      expect(tipos.filter((t) => t === "resultado")).toHaveLength(2);
      expect(tipos).toContain("resultado_removido");
    });
  });

  describe("BAUD-01: login de outra conta não zera o limite nem dá passe global", () => {
    const errar = (xff = "9.9.9.9") =>
      request(app.getHttpServer()).post("/auth/entrar").set("Origin", ORIGEM).set("X-Bolao", "1").set("X-Forwarded-For", xff).send(login("admin@teste.local", "errada-errada-1"));

    it("logins válidos intercalados não impedem o bloqueio", async () => {
      await novaConta("bia@exemplo.com", "Bia");
      await prisma.tentativa.deleteMany();
      const bia = cliente(app);
      const st: number[] = [];
      for (let i = 0; i < 14; i++) {
        st.push((await errar()).status);
        if (i % 3 === 2) await bia.post("/auth/entrar", login("bia@exemplo.com", "senha-da-organizadora-1"));
      }
      expect(st.filter((s) => s === 401).length).toBeLessThanOrEqual(10);
      expect(st.filter((s) => s === 429).length).toBeGreaterThanOrEqual(4);
    });

    it("o aparelho de outra conta não dispensa o teto global contra o admin", async () => {
      const bia = await novaConta("bia@exemplo.com", "Bia");
      await bia.post("/auth/entrar", login("bia@exemplo.com", "senha-da-organizadora-1")).expect(200); // ganha cookie de aparelho
      await prisma.tentativa.deleteMany();
      await prisma.tentativa.createMany({ data: Array.from({ length: 30 }, () => ({ chave: "login:falha" })) });
      // com o aparelho da Bia, tentar a senha do admin continua barrado
      const r = await bia.post("/auth/entrar", login("admin@teste.local", "senha-de-teste-123"));
      expect(r.status).toBe(429);
      // a própria Bia, no aparelho dela, ainda entra
      await bia.post("/auth/entrar", login("bia@exemplo.com", "senha-da-organizadora-1")).expect(200);
    });

    it("conta desativada: o aparelho dela não vale como passe", async () => {
      const bia = await novaConta("bia@exemplo.com", "Bia");
      await bia.post("/auth/entrar", login("bia@exemplo.com", "senha-da-organizadora-1")).expect(200);
      const adm = await entrarComoAdmin(app);
      const uid = ((await adm.get("/usuarios")).body as { id: number; email: string }[]).find((u) => u.email === "bia@exemplo.com")!.id;
      await adm.post(`/usuarios/${uid}/ativo`, { ativo: false }).expect(204);
      await prisma.tentativa.deleteMany();
      await prisma.tentativa.createMany({ data: Array.from({ length: 30 }, () => ({ chave: "login:falha" })) });
      expect((await bia.post("/auth/entrar", login("bia@exemplo.com", "senha-da-organizadora-1"))).status).toBe(429);
    });
  });

  describe("BAUD-02: trilha das ações do administrador sobre uma conta", () => {
    it("link emitido, senha por link e perfis aparecem para a própria pessoa", async () => {
      const bia = await novaConta("bia@exemplo.com", "Bia");
      const adm = await entrarComoAdmin(app);
      const uid = ((await adm.get("/usuarios")).body as { id: number; email: string }[]).find((u) => u.email === "bia@exemplo.com")!.id;
      const { token } = (await adm.post(`/usuarios/${uid}/link`).expect(201)).body as { token: string };
      await adm.patch(`/usuarios/${uid}/perfis`, { admin: true }).expect(204);
      await cliente(app).post(`/convite-organizador/${token}`, { senha: "girafa-roxa-teclado-nuvem" }).expect(200);
      const entrou = cliente(app);
      await entrou.post("/auth/entrar", login("bia@exemplo.com", "girafa-roxa-teclado-nuvem")).expect(200);
      void bia;
      const ativ = (await entrou.get("/auth/atividade").expect(200)).body as { descricao: string; por: string | null }[];
      const textos = ativ.map((a) => a.descricao).join(" | ");
      expect(textos).toContain("gerou um link para trocar a senha");
      expect(textos).toContain("Perfis alterados");
      expect(textos).toContain("Senha trocada por link de acesso");
      expect(ativ.find((a) => a.descricao.includes("gerou um link"))!.por).toBeTruthy();
      expect(ativ.find((a) => a.descricao.includes("Senha trocada por link"))!.por).toBeNull();
    });
  });

  describe("BAUD-08: teto de valor por participante", () => {
    it("jogos que passariam de R$ 1 mi dão 409, e o pagamento acima do teto dá 400", async () => {
      const adm = await entrarComoAdmin(app);
      const { id } = (await adm.post("/boloes", { nome: "Teto", tipo: "NORMAL", dataSorteio: DATA })).body as { id: number };
      const { id: pid } = (await adm.post(`/boloes/${id}/participantes`, { nome: "Rico" }).expect(201)).body as { id: number };
      const vinte = Array.from({ length: 20 }, (_, i) => i + 1); // R$ 232.560,00 cada
      for (let i = 0; i < 4; i++) await adm.post(`/boloes/${id}/jogos`, { participanteId: pid, jogos: [vinte] }).expect(201);
      const r = await adm.post(`/boloes/${id}/jogos`, { participanteId: pid, jogos: [vinte] });
      expect(r.status).toBe(409);
      expect(r.body.codigo).toBe("limite_valor");
      // 4 jogos = R$ 930.240,00: dentro do teto, "confirmar recebido" funciona
      await adm.post(`/boloes/${id}/participantes/${pid}/pagamento`, {}).expect(204);
      const alto = await adm.post(`/boloes/${id}/participantes/${pid}/pagamento`, { valor: 100_000_001 });
      expect(alto.status).toBe(400);
    });
  });
});
