// Vários organizadores: cada um é o tesoureiro dos próprios bolões.
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { PrismaService } from "../src/prisma/prisma.service";
import { cliente, entrarComoAdmin, limpar, subirApp, login } from "./util";

describe("vários organizadores", () => {
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

  /** ADMIN convida; a pessoa aceita pelo link e já sai logada. */
  async function novoOrganizador(email: string, nome: string) {
    const adm = await entrarComoAdmin(app);
    const { token } = (await adm.post("/organizadores/convites", { email, nome }).expect(201)).body as { token: string };
    const org = cliente(app);
    expect((await org.get(`/convite-organizador/${token}`).expect(200)).body).toEqual({ email, nome, tipo: "novo" });
    await org.post(`/convite-organizador/${token}`, { nome, senha: "senha-da-organizadora-1" }).expect(200);
    return { org, token };
  }

  it("convite cria a conta, abre sessão e é de uso único", async () => {
    const { org, token } = await novoOrganizador("bia@exemplo.com", "Bia");
    const eu = (await org.get("/auth/eu").expect(200)).body;
    expect(eu).toMatchObject({ email: "bia@exemplo.com", nome: "Bia", papel: "ORGANIZADOR" });
    await cliente(app).get(`/convite-organizador/${token}`).expect(404);
    await cliente(app).post(`/convite-organizador/${token}`, { nome: "Outra", senha: "outra-senha-longa-1" }).expect(404);
    // e ela entra depois com e-mail e senha
    await cliente(app).post("/auth/entrar", login("bia@exemplo.com", "senha-da-organizadora-1")).expect(200);
  });

  it("senha curta no convite é recusada", async () => {
    const adm = await entrarComoAdmin(app);
    const { token } = (await adm.post("/organizadores/convites", { email: "c@exemplo.com", nome: "Cid" })).body as { token: string };
    await cliente(app).post(`/convite-organizador/${token}`, { nome: "Cid", senha: "curta" }).expect(400);
  });

  it("isolamento: organizador B não vê nem mexe em nada do bolão de A (tudo 404)", async () => {
    const adm = await entrarComoAdmin(app);
    const { id } = (await adm.post("/boloes", { nome: "Bolão do Admin", tipo: "NORMAL" }).expect(201)).body as { id: number };
    const conv = (await adm.get(`/boloes/${id}`)).body.bolao.convite as string;
    await adm.patch(`/boloes/${id}`, { pixChave: "admin@exemplo.com", pixNome: "Admin", pixCidade: "SP" }).expect(204);
    const ana = cliente(app);
    await ana.post(`/convites/${conv}/inscricao`, { nome: "Ana", whatsapp: "11 97777-6666" }).expect(200);
    await ana.post(`/convites/${conv}/jogos`, { dezenas: [1, 2, 3, 4, 5, 6] }).expect(204);
    const r = (await adm.get(`/boloes/${id}`)).body;
    const pid = r.participantes[0].id as number;
    const jid = r.jogos[0].id as number;

    const { org: bia } = await novoOrganizador("bia@exemplo.com", "Bia");
    expect((await bia.get("/boloes").expect(200)).body).toEqual([]);
    const tentativas = [
      () => bia.get(`/boloes/${id}`),
      () => bia.get(`/boloes/${id}/exportar.csv`),
      () => bia.get(`/boloes/${id}/eventos`),
      () => bia.patch(`/boloes/${id}`, { pixChave: "golpe@exemplo.com" }),
      () => bia.post(`/boloes/${id}/convite`),
      () => bia.post(`/boloes/${id}/inscricoes`, { abertas: false }),
      () => bia.post(`/boloes/${id}/participantes`, { nome: "Intruso" }),
      () => bia.post(`/boloes/${id}/participantes/${pid}/pagamento`, {}),
      () => bia.del(`/boloes/${id}/participantes/${pid}`),
      () => bia.post(`/boloes/${id}/jogos`, { participanteId: pid, jogos: [[7, 8, 9, 10, 11, 12]] }),
      () => bia.post(`/boloes/${id}/jogos/${jid}/registro`, { registrado: true }),
      () => bia.del(`/boloes/${id}/jogos/${jid}`),
      () => bia.post(`/boloes/${id}/resultado`, { dezenas: [1, 2, 3, 4, 5, 6], premios: { sena: 1, quina: 0, quadra: 0 } }),
      () => bia.post(`/boloes/${id}/excluir`, { confirmacao: "Bolão do Admin" }),
    ];
    for (const t of tentativas) expect((await t()).status).toBe(404);

    // nada mudou
    const depois = (await adm.get(`/boloes/${id}`)).body;
    expect(depois.bolao.pix.chave).toBe("admin@exemplo.com");
    expect(depois.participantes).toHaveLength(1);
    expect(depois.participantes[0].pago).toBe(0);
    expect(depois.jogos[0].registrado).toBe(false);
    expect(depois.bolao.resultado).toBeNull();

    // visão de organizador no painel do participante: só para o dono
    expect((await bia.get(`/convites/${conv}/painel`)).status).toBe(401);
    expect((await adm.get(`/convites/${conv}/painel`).expect(200)).body.visaoOrganizador).toBe(true);
  });

  it("cada um lista e cria só os seus", async () => {
    const { org: bia } = await novoOrganizador("bia@exemplo.com", "Bia");
    await bia.post("/boloes", { nome: "Bolão da Bia", tipo: "VIRADA" }).expect(201);
    const adm = await entrarComoAdmin(app);
    await adm.post("/boloes", { nome: "Bolão do Admin", tipo: "NORMAL" }).expect(201);
    expect(((await bia.get("/boloes")).body as { nome: string }[]).map((b) => b.nome)).toEqual(["Bolão da Bia"]);
    expect(((await adm.get("/boloes")).body as { nome: string }[]).map((b) => b.nome)).toEqual(["Bolão do Admin"]);
  });

  it("só o ADMIN gerencia organizadores", async () => {
    const { org: bia } = await novoOrganizador("bia@exemplo.com", "Bia");
    await bia.get("/organizadores").expect(403);
    await bia.post("/organizadores/convites", { email: "x@exemplo.com", nome: "X" }).expect(403);
    await cliente(app).get("/organizadores").expect(401);
    const lista = (await (await entrarComoAdmin(app)).get("/organizadores").expect(200)).body as { email: string; boloes: number }[];
    expect(lista.map((o) => o.email)).toEqual(["admin@teste.local", "bia@exemplo.com"]);
  });

  it("desativar derruba a sessão na hora e impede o login; reativar volta", async () => {
    const { org: bia } = await novoOrganizador("bia@exemplo.com", "Bia");
    const adm = await entrarComoAdmin(app);
    const uid = ((await adm.get("/organizadores")).body as { id: number; email: string }[]).find((o) => o.email === "bia@exemplo.com")!.id;
    await adm.post(`/organizadores/${uid}/ativo`, { ativo: false }).expect(204);
    await bia.get("/boloes").expect(401);
    await cliente(app).post("/auth/entrar", login("bia@exemplo.com", "senha-da-organizadora-1")).expect(401);
    await adm.post(`/organizadores/${uid}/ativo`, { ativo: true }).expect(204);
    await cliente(app).post("/auth/entrar", login("bia@exemplo.com", "senha-da-organizadora-1")).expect(200);
    // não desativa a si mesmo
    const meuId = ((await adm.get("/auth/eu")).body as { id: number }).id;
    expect((await adm.post(`/organizadores/${meuId}/ativo`, { ativo: false })).status).toBe(400);
  });

  it("troca de senha por link: senha nova vale, antiga não, sessões antigas caem", async () => {
    const { org: bia } = await novoOrganizador("bia@exemplo.com", "Bia");
    const adm = await entrarComoAdmin(app);
    const uid = ((await adm.get("/organizadores")).body as { id: number; email: string }[]).find((o) => o.email === "bia@exemplo.com")!.id;
    const { token } = (await adm.post(`/organizadores/${uid}/link`).expect(201)).body as { token: string };
    expect((await cliente(app).get(`/convite-organizador/${token}`)).body.tipo).toBe("troca");
    await cliente(app).post(`/convite-organizador/${token}`, { nome: "Bia", senha: "senha-nova-da-bia-2" }).expect(200);
    await bia.get("/boloes").expect(401);
    await cliente(app).post("/auth/entrar", login("bia@exemplo.com", "senha-da-organizadora-1")).expect(401);
    await cliente(app).post("/auth/entrar", login("bia@exemplo.com", "senha-nova-da-bia-2")).expect(200);
  });

  it("e-mail já cadastrado dá 409; conta fica pendente e novo link invalida o anterior", async () => {
    const adm = await entrarComoAdmin(app);
    await adm.post("/organizadores/convites", { email: "admin@teste.local", nome: "Dup" }).expect(409);
    const a = (await adm.post("/organizadores/convites", { email: "d@exemplo.com", nome: "Davi" }).expect(201)).body as { token: string };
    await adm.post("/organizadores/convites", { email: "d@exemplo.com", nome: "Davi" }).expect(409);
    const lista = (await adm.get("/organizadores")).body as { id: number; email: string; pendente: boolean }[];
    const davi = lista.find((o) => o.email === "d@exemplo.com")!;
    expect(davi.pendente).toBe(true);
    // conta pendente não entra (sem senha)
    await cliente(app).post("/auth/entrar", login("d@exemplo.com", "qualquer-senha-longa")).expect(401);
    const b = (await adm.post(`/organizadores/${davi.id}/link`).expect(201)).body as { token: string };
    await cliente(app).get(`/convite-organizador/${a.token}`).expect(404);
    expect((await cliente(app).get(`/convite-organizador/${b.token}`).expect(200)).body.tipo).toBe("novo");
    const c = await prisma.conviteOrganizador.findFirstOrThrow({ where: { usuarioId: davi.id, usadoEm: null } });
    expect(c.tokenHash).toHaveLength(64);
    expect(c.tokenHash).not.toBe(b.token);
  });

  it("dois aceites simultâneos do mesmo convite criam uma conta só", async () => {
    const adm = await entrarComoAdmin(app);
    const { token } = (await adm.post("/organizadores/convites", { email: "e@exemplo.com", nome: "Eva" })).body as { token: string };
    const st = await Promise.all(
      [1, 2, 3].map(() => cliente(app).post(`/convite-organizador/${token}`, { nome: "Eva", senha: "senha-da-eva-longa-1" })),
    );
    expect(st.map((r) => r.status).filter((s) => s === 200)).toHaveLength(1);
    expect(await prisma.usuario.count({ where: { email: "e@exemplo.com" } })).toBe(1);
  });

  describe("esquema de login do gestor", () => {
    it("senha em texto puro no login é recusada", async () => {
      const r = await cliente(app).post("/auth/entrar", { email: "admin@teste.local", senha: "senha-de-teste-123" });
      expect(r.status).toBe(400);
      const cifra = await cliente(app).post("/auth/entrar", { email: "admin@teste.local", senhaCifrada: Buffer.alloc(256, 1).toString("base64") });
      expect(cifra.status).toBe(401);
    });

    it("chave pública disponível sem login", async () => {
      expect((await cliente(app).get("/auth/chave-publica").expect(200)).body.chavePublica).toContain("BEGIN PUBLIC KEY");
    });

    it("política de senha no convite: comum, sequência e o próprio nome", async () => {
      const adm = await entrarComoAdmin(app);
      const { token } = (await adm.post("/organizadores/convites", { email: "fabio.souza@exemplo.com", nome: "Fabio Souza" })).body as { token: string };
      const tenta = (senha: string) => cliente(app).post(`/convite-organizador/${token}`, { nome: "Fabio Souza", senha });
      expect((await tenta("MegaDaVirada2026")).body.codigo).toBe("senha_comum");
      expect((await tenta("abcdefghijkl")).body.codigo).toBe("senha_comum");
      expect((await tenta("fabiosouza2026")).body.codigo).toBe("senha_pessoal");
      await tenta("cavalo-azul-bateria-grampo").expect(200);
    });

    it("esqueci: mesma resposta para conta que existe e que não existe; só a existente ganha link", async () => {
      const { org: _bia } = await novoOrganizador("bia@exemplo.com", "Bia");
      const antes = await prisma.conviteOrganizador.count();
      const sim = await cliente(app).post("/auth/esqueci", { email: "bia@exemplo.com" });
      const nao = await cliente(app).post("/auth/esqueci", { email: "ninguem@exemplo.com" });
      expect(sim.status).toBe(202);
      expect(nao.status).toBe(202);
      expect(sim.body).toEqual(nao.body);
      expect(await prisma.conviteOrganizador.count()).toBe(antes + 1);
    });

    it("códigos de recuperação: exigem a senha, valem uma vez e derrubam as sessões", async () => {
      const { org: bia } = await novoOrganizador("bia@exemplo.com", "Bia");
      await bia.post("/auth/codigos", { senha: "errada" }).expect(401);
      const { codigos } = (await bia.post("/auth/codigos", { senha: "senha-da-organizadora-1" }).expect(200)).body as { codigos: string[] };
      expect(codigos).toHaveLength(8);
      expect(codigos[0]).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect((await bia.get("/auth/codigos")).body.restantes).toBe(8);
      expect(await prisma.codigoRecuperacao.count({ where: { codigoHash: codigos[0] } })).toBe(0); // só hash

      const r = cliente(app);
      await r.post("/auth/recuperar", { email: "bia@exemplo.com", codigo: codigos[0].toLowerCase(), novaSenha: "girafa-roxa-teclado-nuvem" }).expect(200);
      await r.get("/boloes").expect(200); // já entrou
      await bia.get("/boloes").expect(401); // sessão antiga caiu
      await cliente(app).post("/auth/recuperar", { email: "bia@exemplo.com", codigo: codigos[0], novaSenha: "outra-girafa-roxa-teclado" }).expect(401);
      await cliente(app).post("/auth/entrar", login("bia@exemplo.com", "girafa-roxa-teclado-nuvem")).expect(200);
      // código de outra pessoa não serve
      await cliente(app).post("/auth/recuperar", { email: "admin@teste.local", codigo: codigos[1], novaSenha: "girafa-roxa-teclado-nuvem" }).expect(401);
    });
  });
});
