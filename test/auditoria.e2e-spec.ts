// Testes dos achados da auditoria do agente (SEC-01 a SEC-08, 04/11/2026).
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";
import { ORIGEM, cliente, entrarComoAdmin, limpar, subirApp } from "./util";

describe("auditoria do agente", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await subirApp());
  });
  beforeEach(async () => {
    await limpar(prisma);
    await prisma.aparelhoOrganizador.deleteMany();
  });
  afterAll(async () => {
    await app.close();
  });

  async function novoBolao(adm: ReturnType<typeof cliente>, nome = "Auditoria") {
    const { id } = (await adm.post("/boloes", { nome, tipo: "NORMAL" }).expect(201)).body as { id: number };
    const conv = (await adm.get(`/boloes/${id}`)).body.bolao.convite as string;
    return { id, conv };
  }

  describe("SEC-01: rateio tardio", () => {
    it("quem entra e paga depois, sem jogo registrado, fica com parte 0", async () => {
      const adm = await entrarComoAdmin(app);
      const { id, conv } = await novoBolao(adm);
      const ana = cliente(app);
      await ana.post(`/convites/${conv}/inscricao`, { nome: "Ana" }).expect(200);
      await ana.post(`/convites/${conv}/jogos`, { dezenas: [1, 2, 3, 4, 5, 6] }).expect(204);
      const beto = cliente(app);
      await beto.post(`/convites/${conv}/inscricao`, { nome: "Beto" }).expect(200);
      await beto.post(`/convites/${conv}/jogos`, { dezenas: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }).expect(204);
      let r = (await adm.get(`/boloes/${id}`)).body;
      for (const p of r.participantes) await adm.post(`/boloes/${id}/participantes/${p.id}/pagamento`, {}).expect(204);
      const jogoAna = r.jogos.find((j: { dezenas: number[] }) => j.dezenas.length === 6).id as number;
      await adm.post(`/boloes/${id}/jogos/${jogoAna}/registro`, { registrado: true }).expect(204);
      await adm.post(`/boloes/${id}/resultado`, { dezenas: [1, 2, 3, 4, 5, 6], premios: { sena: 10_000_000_000, quina: 0, quadra: 0 } }).expect(204);
      r = (await adm.get(`/boloes/${id}`)).body;
      const parte = (nome: string) => r.participantes.find((p: { nome: string }) => p.nome === nome).parte;
      expect(parte("Ana")).toBe(10_000_000_000);
      expect(parte("Beto")).toBe(0);
    });

    it("depois do horário do sorteio: inscrição e jogo novo dão 409", async () => {
      const adm = await entrarComoAdmin(app);
      const { id, conv } = await novoBolao(adm);
      const ana = cliente(app);
      await ana.post(`/convites/${conv}/inscricao`, { nome: "Ana" }).expect(200);
      await adm.patch(`/boloes/${id}`, { dataSorteio: new Date(Date.now() - 60_000).toISOString() }).expect(204);
      expect((await ana.post(`/convites/${conv}/jogos`, { dezenas: [1, 2, 3, 4, 5, 6] })).status).toBe(409);
      expect((await cliente(app).post(`/convites/${conv}/inscricao`, { nome: "Tarde" })).status).toBe(409);
      const painel = (await ana.get(`/convites/${conv}/painel`)).body;
      expect(painel.bolao.inscricoesAbertas).toBe(false);
      expect(painel.bolao.travado).toBe(true);
    });

    it("não reabre inscrições com resultado nem depois do sorteio", async () => {
      const adm = await entrarComoAdmin(app);
      const { id } = await novoBolao(adm);
      await adm.post(`/boloes/${id}/resultado`, { dezenas: [1, 2, 3, 4, 5, 6], premios: { sena: 0, quina: 0, quadra: 0 } }).expect(204);
      expect((await adm.post(`/boloes/${id}/inscricoes`, { abertas: true })).body.codigo).toBe("tem_resultado");
      const b = await novoBolao(adm, "Outro");
      await adm.patch(`/boloes/${b.id}`, { dataSorteio: new Date(Date.now() - 60_000).toISOString() }).expect(204);
      expect((await adm.post(`/boloes/${b.id}/inscricoes`, { abertas: true })).body.codigo).toBe("sorteio_passou");
    });
  });

  describe("SEC-04: mudanças no rateio com bolão travado exigem confirmação", () => {
    it("preço, jogo, remoção e pagamento: 409 sem confirmar, 204 com, e evento gravado", async () => {
      const adm = await entrarComoAdmin(app);
      const { id, conv } = await novoBolao(adm);
      const ana = cliente(app);
      await ana.post(`/convites/${conv}/inscricao`, { nome: "Ana" }).expect(200);
      await ana.post(`/convites/${conv}/jogos`, { dezenas: [1, 2, 3, 4, 5, 6] }).expect(204);
      await ana.post(`/convites/${conv}/jogos`, { dezenas: [7, 8, 9, 10, 11, 12] }).expect(204);
      let r = (await adm.get(`/boloes/${id}`)).body;
      const pid = r.participantes[0].id as number;
      await adm.post(`/boloes/${id}/resultado`, { dezenas: [1, 2, 3, 4, 5, 6], premios: { sena: 100, quina: 0, quadra: 0 } }).expect(204);

      const casos: [() => request.Test, () => request.Test][] = [
        [() => adm.patch(`/boloes/${id}`, { precoSimples: 100 }), () => adm.patch(`/boloes/${id}?confirmar=1`, { precoSimples: 100 })],
        [
          () => adm.post(`/boloes/${id}/jogos`, { participanteId: pid, jogos: [[20, 21, 22, 23, 24, 25]] }),
          () => adm.post(`/boloes/${id}/jogos?confirmar=1`, { participanteId: pid, jogos: [[20, 21, 22, 23, 24, 25]] }),
        ],
        [() => adm.del(`/boloes/${id}/jogos/${r.jogos[1].id}`), () => adm.del(`/boloes/${id}/jogos/${r.jogos[1].id}?confirmar=1`)],
        [() => adm.post(`/boloes/${id}/participantes/${pid}/pagamento`, {}), () => adm.post(`/boloes/${id}/participantes/${pid}/pagamento?confirmar=1`, {})],
      ];
      for (const [sem, com] of casos) {
        const s = await sem();
        expect(s.status).toBe(409);
        expect(s.body.codigo).toBe("bolao_travado");
        expect([201, 204]).toContain((await com()).status);
      }
      r = (await adm.get(`/boloes/${id}`)).body;
      expect(r.bolao.precoSimples).toBe(100);
      const tipos = ((await adm.get(`/boloes/${id}/eventos`)).body as { tipo: string }[]).map((e) => e.tipo);
      expect(tipos).toEqual(expect.arrayContaining(["preco_alterado", "jogos_adicionados", "jogo_removido", "pagamento"]));
    });

    it("editar participante gera evento", async () => {
      const adm = await entrarComoAdmin(app);
      const { id } = await novoBolao(adm);
      const { id: pid } = (await adm.post(`/boloes/${id}/participantes`, { nome: "Ana" })).body as { id: number };
      await adm.patch(`/boloes/${id}/participantes/${pid}`, { nome: "Ana Maria" }).expect(204);
      const ev = (await adm.get(`/boloes/${id}/eventos`)).body as { tipo: string; descricao: string }[];
      expect(ev[0].tipo).toBe("participante_editado");
      expect(ev[0].descricao).toContain("Ana Maria");
    });
  });

  describe("SEC-05: limites atômicos", () => {
    it("40 logins errados simultâneos testam no máximo 5 senhas", async () => {
      const reqs = Array.from({ length: 40 }, () =>
        request(app.getHttpServer())
          .post("/auth/entrar")
          .set("Origin", ORIGEM)
          .set("X-Bolao", "1")
          .send({ email: "admin@teste.local", senha: "errada" }),
      );
      const st = (await Promise.all(reqs)).map((r) => r.status);
      expect(st.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
      expect(st.filter((s) => s === 429).length).toBeGreaterThanOrEqual(35);
    });

    it("8 inscrições simultâneas com o mesmo aparelho criam 1 participante", async () => {
      const adm = await entrarComoAdmin(app);
      const { id, conv } = await novoBolao(adm);
      const p = cliente(app);
      // Primeiro um bolão qualquer para o aparelho ter um token emitido pelo servidor.
      const outro = await novoBolao(adm, "Aquecimento");
      await p.post(`/convites/${outro.conv}/inscricao`, { nome: "Ana" }).expect(200);
      const cookie = (await prisma.dispositivoAcesso.count()) === 1;
      expect(cookie).toBe(true);
      await Promise.all(Array.from({ length: 8 }, () => p.post(`/convites/${conv}/inscricao`, { nome: "Ana" })));
      expect(await prisma.participante.count({ where: { bolaoId: id } })).toBe(1);
    });
  });

  describe("SEC-06: limite global não tranca o aparelho conhecido do organizador", () => {
    it("com 30 falhas de outros IPs, o organizador entra pelo aparelho de sempre", async () => {
      const adm = cliente(app);
      await adm.post("/auth/entrar", { email: "admin@teste.local", senha: "senha-de-teste-123" }).expect(200);
      await prisma.tentativa.createMany({ data: Array.from({ length: 30 }, () => ({ chave: "login:falha" })) });
      // aparelho novo: barrado pelo teto global
      expect((await cliente(app).post("/auth/entrar", { email: "admin@teste.local", senha: "senha-de-teste-123" })).status).toBe(429);
      // aparelho conhecido (cookie bolao_org do login anterior): entra
      await adm.post("/auth/entrar", { email: "admin@teste.local", senha: "senha-de-teste-123" }).expect(200);
    });
  });

  describe("SEC-07: cookie de aparelho escolhido pelo cliente", () => {
    it("valor desconhecido é trocado por um token novo do servidor", async () => {
      const adm = await entrarComoAdmin(app);
      const { conv } = await novoBolao(adm);
      const r = await request(app.getHttpServer())
        .post(`/convites/${conv}/inscricao`)
        .set("Origin", ORIGEM)
        .set("X-Bolao", "1")
        .set("Cookie", "bolao_aparelho=aaaaaaaa")
        .send({ nome: "Vítima" })
        .expect(200);
      const set = (r.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("bolao_aparelho="))!;
      expect(set).not.toContain("bolao_aparelho=aaaaaaaa;");
      await request(app.getHttpServer()).get(`/convites/${conv}/painel`).set("Cookie", "bolao_aparelho=aaaaaaaa").expect(401);
    });
  });

  describe("SEC-08: id fora do int4", () => {
    it("dá 404, não 500", async () => {
      const adm = await entrarComoAdmin(app);
      await adm.get("/boloes/99999999999").expect(404);
      await adm.get("/boloes/0").expect(404);
      await adm.get("/boloes/-1").expect(404);
      await adm.get("/boloes/1e3").expect(404);
    });
  });

  describe("agrupamento de IPv6", () => {
    it("endereços do mesmo /64 caem na mesma chave", async () => {
      const { agruparIp } = await import("../src/common/limites.service");
      expect(agruparIp("2001:db8:abcd:12::1")).toBe(agruparIp("2001:db8:abcd:12:ffff:1:2:3"));
      expect(agruparIp("2001:db8:abcd:12::1")).not.toBe(agruparIp("2001:db8:abcd:13::1"));
      expect(agruparIp("::ffff:10.0.0.1")).toBe("10.0.0.1");
      expect(agruparIp("10.0.0.1")).toBe("10.0.0.1");
    });
  });

  describe("tesoureiro: só o organizador exporta, imprime, digita e registra", () => {
    it("participante e anônimo recebem 401 em tudo que é do organizador", async () => {
      const adm = await entrarComoAdmin(app);
      const { id, conv } = await novoBolao(adm);
      const ana = cliente(app);
      await ana.post(`/convites/${conv}/inscricao`, { nome: "Ana", whatsapp: "11 98888-7777" }).expect(200);
      await ana.post(`/convites/${conv}/jogos`, { dezenas: [1, 2, 3, 4, 5, 6] }).expect(204);
      const jid = (await adm.get(`/boloes/${id}`)).body.jogos[0].id as number;
      const anonimo = cliente(app);
      for (const quem of [ana, anonimo]) {
        await quem.get(`/boloes/${id}/exportar.csv`).expect(401); // planilha
        await quem.get(`/boloes/${id}`).expect(401); // folha da lotérica e modo digitação usam esta
        await quem.get(`/boloes/${id}/eventos`).expect(401);
        await quem.get("/boloes").expect(401);
        await quem.post(`/boloes/${id}/jogos/${jid}/registro`, { registrado: true }).expect(401);
        await quem.post(`/boloes/${id}/participantes/1/pagamento`, {}).expect(401);
        await quem.patch(`/boloes/${id}`, { pixChave: "golpe@exemplo.com" }).expect(401);
        await quem.post(`/boloes/${id}/convite`).expect(401);
        await quem.get("/caixa/megasena").expect(401);
      }
      // o participante só vê o painel do bolão, sem WhatsApp de ninguém
      const painel = await ana.get(`/convites/${conv}/painel`).expect(200);
      expect(JSON.stringify(painel.body)).not.toContain("98888");
    });
  });
});
