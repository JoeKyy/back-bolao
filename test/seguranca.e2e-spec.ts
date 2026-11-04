import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";
import { ORIGEM, cliente, entrarComoAdmin, limpar, subirApp } from "./util";

describe("segurança", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await subirApp());
  });
  beforeEach(async () => {
    await limpar(prisma);
  });
  afterAll(async () => {
    await app.close();
  });

  describe("BOL-01: limite de login", () => {
    const errar = (xff: string) =>
      request(app.getHttpServer())
        .post("/auth/entrar")
        .set("Origin", ORIGEM)
        .set("X-Bolao", "1")
        .set("X-Forwarded-For", xff)
        .send({ email: "admin@teste.local", senha: "errada" });

    it("trocar X-Forwarded-For a cada tentativa NÃO burla o bloqueio", async () => {
      const status: number[] = [];
      for (let i = 1; i <= 7; i++) status.push((await errar(`10.9.9.${i}`)).status);
      expect(status).toEqual([401, 401, 401, 401, 401, 429, 429]);
    });

    it("a contagem fica no banco: sobrevive a reiniciar a API", async () => {
      for (let i = 0; i < 5; i++) await errar("1.1.1.1");
      await app.close();
      ({ app, prisma } = await subirApp());
      expect((await errar("1.1.1.1")).status).toBe(429);
    });

    it("bloqueado, nem a senha certa entra", async () => {
      for (let i = 0; i < 5; i++) await errar("1.1.1.1");
      const r = await cliente(app).post("/auth/entrar", { email: "admin@teste.local", senha: "senha-de-teste-123" });
      expect(r.status).toBe(429);
    });
  });

  describe("BOL-02: sessão do organizador", () => {
    it("sem sessão, rotas do organizador dão 401", async () => {
      await cliente(app).get("/boloes").expect(401);
    });

    it("logout invalida a sessão no servidor: cookie copiado antes não vale mais", async () => {
      const c = await entrarComoAdmin(app);
      const s = await prisma.sessao.findFirstOrThrow();
      expect(s.tokenHash).toHaveLength(64); // só o hash no banco
      const login = await request(app.getHttpServer())
        .post("/auth/entrar")
        .set("Origin", ORIGEM)
        .set("X-Bolao", "1")
        .send({ email: "admin@teste.local", senha: "senha-de-teste-123" });
      const cookie = login.headers["set-cookie"] as unknown as string[];
      await request(app.getHttpServer()).get("/boloes").set("Cookie", cookie).expect(200);
      await request(app.getHttpServer()).post("/auth/sair").set("Origin", ORIGEM).set("X-Bolao", "1").set("Cookie", cookie).expect(200);
      await request(app.getHttpServer()).get("/boloes").set("Cookie", cookie).expect(401);
      await c.get("/boloes").expect(200); // a outra sessão continua
    });

    it("cookie forjado ou com valor fixo antigo ('admin.assinatura') não entra", async () => {
      await request(app.getHttpServer()).get("/boloes").set("Cookie", "bolao_sessao=admin.qualquer").expect(401);
    });

    it("cookie da sessão é httpOnly e SameSite=Lax", async () => {
      const r = await cliente(app).post("/auth/entrar", { email: "admin@teste.local", senha: "senha-de-teste-123" });
      const cookie = (r.headers["set-cookie"] as unknown as string[])[0];
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
    });

    it("trocar a senha derruba todas as sessões", async () => {
      const a = await entrarComoAdmin(app);
      const b = await entrarComoAdmin(app);
      await a.post("/auth/senha", { atual: "senha-de-teste-123", nova: "outra-senha-bem-longa" }).expect(200);
      await b.get("/boloes").expect(401);
      // volta a senha para os outros testes
      const c = cliente(app);
      await c.post("/auth/entrar", { email: "admin@teste.local", senha: "outra-senha-bem-longa" }).expect(200);
      await c.post("/auth/senha", { atual: "outra-senha-bem-longa", nova: "senha-de-teste-123" }).expect(200);
    });
  });

  describe("CSRF e CORS", () => {
    it("escrita sem o cabeçalho X-Bolao é recusada", async () => {
      await request(app.getHttpServer())
        .post("/auth/entrar")
        .set("Origin", ORIGEM)
        .send({ email: "admin@teste.local", senha: "senha-de-teste-123" })
        .expect(403);
    });

    it("escrita vinda de outra origem é recusada mesmo com o cabeçalho", async () => {
      await request(app.getHttpServer())
        .post("/auth/entrar")
        .set("Origin", "https://site-malicioso.example")
        .set("X-Bolao", "1")
        .send({ email: "admin@teste.local", senha: "senha-de-teste-123" })
        .expect(403);
    });

    it("CORS não libera origem desconhecida", async () => {
      const r = await request(app.getHttpServer()).options("/boloes").set("Origin", "https://site-malicioso.example").set("Access-Control-Request-Method", "POST");
      expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("BOL-03 e cabeçalhos", () => {
    it("erro de validação não ecoa a entrada", async () => {
      const c = await entrarComoAdmin(app);
      const r = await c.post("/boloes", { nome: "<script>Pague o Pix</script>", tipo: "XYZ" });
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).not.toContain("Pague");
      expect(r.body).toEqual({ codigo: "entrada_invalida", mensagem: "Dados inválidos. Confira o formulário." });
    });

    it("campo extra no corpo é recusado", async () => {
      const c = await entrarComoAdmin(app);
      await c.post("/boloes", { nome: "Teste", tipo: "NORMAL", convite: "meu-token" }).expect(400);
    });

    it("BOL-08: sem X-Powered-By, com no-store, nosniff e no-referrer", async () => {
      const r = await request(app.getHttpServer()).get("/saude").expect(200);
      expect(r.headers["x-powered-by"]).toBeUndefined();
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
      expect(r.headers["referrer-policy"]).toBe("no-referrer");
    });

    it("corpo grande demais é recusado", async () => {
      const c = await entrarComoAdmin(app);
      const r = await c.post("/boloes", { nome: "x".repeat(70_000), tipo: "NORMAL" });
      expect(r.status).toBe(413);
    });
  });

  describe("isolamento entre bolões e participantes", () => {
    async function montar() {
      const adm = await entrarComoAdmin(app);
      const a = (await adm.post("/boloes", { nome: "Bolão A", tipo: "NORMAL" }).expect(201)).body as { id: number };
      const b = (await adm.post("/boloes", { nome: "Bolão B", tipo: "NORMAL" }).expect(201)).body as { id: number };
      const convA = (await adm.get(`/boloes/${a.id}`)).body.bolao.convite as string;
      const convB = (await adm.get(`/boloes/${b.id}`)).body.bolao.convite as string;
      return { adm, a, b, convA, convB };
    }

    it("participante de A não vê o painel de B nem inclui jogo em B", async () => {
      const { convA, convB } = await montar();
      const p = cliente(app);
      await p.post(`/convites/${convA}/inscricao`, { nome: "Ana", whatsapp: "11 99999-0000" }).expect(200);
      await p.get(`/convites/${convA}/painel`).expect(200);
      await p.get(`/convites/${convB}/painel`).expect(401);
      await p.post(`/convites/${convB}/jogos`, { dezenas: [1, 2, 3, 4, 5, 6] }).expect(401);
    });

    it("participante não vê WhatsApp de ninguém nem o convite/Pix do organizador", async () => {
      const { convA, adm, a } = await montar();
      await adm.patch(`/boloes/${a.id}`, { pixChave: "pix@exemplo.com", pixNome: "Joe", pixCidade: "SP" }).expect(204);
      const p = cliente(app);
      await p.post(`/convites/${convA}/inscricao`, { nome: "Ana", whatsapp: "11 99999-0000" }).expect(200);
      const painel = await p.get(`/convites/${convA}/painel`).expect(200);
      const texto = JSON.stringify(painel.body);
      expect(texto).not.toContain("99999");
      expect(texto).not.toContain(convA);
      expect(painel.body.bolao.pix).toBeUndefined();
    });

    it("participante não remove jogo de outro (responde como inexistente)", async () => {
      const { convA } = await montar();
      const ana = cliente(app);
      const beto = cliente(app);
      await ana.post(`/convites/${convA}/inscricao`, { nome: "Ana" }).expect(200);
      await beto.post(`/convites/${convA}/inscricao`, { nome: "Beto" }).expect(200);
      await ana.post(`/convites/${convA}/jogos`, { dezenas: [1, 2, 3, 4, 5, 6] }).expect(204);
      const jogoDaAna = (await ana.get(`/convites/${convA}/painel`)).body.meusJogos[0].id as number;
      await beto.del(`/convites/${convA}/jogos/${jogoDaAna}`).expect(404);
      expect((await ana.get(`/convites/${convA}/painel`)).body.meusJogos).toHaveLength(1);
    });

    it("convite regenerado: link antigo deixa de funcionar", async () => {
      const { adm, a, convA } = await montar();
      await adm.post(`/boloes/${a.id}/convite`).expect(204);
      await cliente(app).get(`/convites/${convA}`).expect(404);
    });

    it("token de convite com formato estranho é recusado sem ir ao banco", async () => {
      await cliente(app).get(`/convites/${encodeURIComponent("' OR 1=1 --")}`).expect(404);
    });
  });

  describe("BOL-05: inscrição com limite", () => {
    it("o 11º cadastro do mesmo IP em 10 min é recusado", async () => {
      const adm = await entrarComoAdmin(app);
      const b = (await adm.post("/boloes", { nome: "Cheio", tipo: "NORMAL" })).body as { id: number };
      const conv = (await adm.get(`/boloes/${b.id}`)).body.bolao.convite as string;
      const st: number[] = [];
      for (let i = 0; i < 11; i++) st.push((await cliente(app).post(`/convites/${conv}/inscricao`, { nome: `Pessoa ${i}` })).status);
      expect(st.slice(0, 10).every((s) => s === 200)).toBe(true);
      expect(st[10]).toBe(429);
    });

    it("teto de participantes do bolão", async () => {
      const adm = await entrarComoAdmin(app);
      const b = (await adm.post("/boloes", { nome: "Pequeno", tipo: "NORMAL" })).body as { id: number };
      await adm.patch(`/boloes/${b.id}`, { maxParticipantes: 2 }).expect(204);
      const conv = (await adm.get(`/boloes/${b.id}`)).body.bolao.convite as string;
      await cliente(app).post(`/convites/${conv}/inscricao`, { nome: "Um" }).expect(200);
      await cliente(app).post(`/convites/${conv}/inscricao`, { nome: "Dois" }).expect(200);
      const r = await cliente(app).post(`/convites/${conv}/inscricao`, { nome: "Três" });
      expect(r.status).toBe(409);
      expect(r.body.codigo).toBe("bolao_cheio");
    });
  });

  describe("exportação CSV", () => {
    it("neutraliza fórmulas (CSV injection)", async () => {
      const adm = await entrarComoAdmin(app);
      const b = (await adm.post("/boloes", { nome: "Planilha", tipo: "NORMAL" })).body as { id: number };
      const p = (await adm.post(`/boloes/${b.id}/participantes`, { nome: "=HYPERLINK(\"http://x\")" }).expect(201)).body as { id: number };
      await adm.post(`/boloes/${b.id}/jogos`, { participanteId: p.id, jogos: [[1, 2, 3, 4, 5, 6]] }).expect(201);
      const r = await adm.get(`/boloes/${b.id}/exportar.csv`).expect(200);
      expect(r.text).toContain(`"'=HYPERLINK(""http://x"")"`);
    });
  });
});
