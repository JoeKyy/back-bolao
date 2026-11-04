// Vários organizadores: cada um é o tesoureiro dos próprios bolões.
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { PrismaService } from "../src/prisma/prisma.service";
import { cliente, entrarComoAdmin, limpar, subirApp } from "./util";

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
    await cliente(app).post("/auth/entrar", { email: "bia@exemplo.com", senha: "senha-da-organizadora-1" }).expect(200);
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
    await cliente(app).post("/auth/entrar", { email: "bia@exemplo.com", senha: "senha-da-organizadora-1" }).expect(401);
    await adm.post(`/organizadores/${uid}/ativo`, { ativo: true }).expect(204);
    await cliente(app).post("/auth/entrar", { email: "bia@exemplo.com", senha: "senha-da-organizadora-1" }).expect(200);
    // não desativa a si mesmo
    const meuId = ((await adm.get("/auth/eu")).body as { id: number }).id;
    expect((await adm.post(`/organizadores/${meuId}/ativo`, { ativo: false })).status).toBe(400);
  });

  it("troca de senha por link: senha nova vale, antiga não, sessões antigas caem", async () => {
    const { org: bia } = await novoOrganizador("bia@exemplo.com", "Bia");
    const adm = await entrarComoAdmin(app);
    const uid = ((await adm.get("/organizadores")).body as { id: number; email: string }[]).find((o) => o.email === "bia@exemplo.com")!.id;
    const { token } = (await adm.post(`/organizadores/${uid}/troca-senha`).expect(201)).body as { token: string };
    expect((await cliente(app).get(`/convite-organizador/${token}`)).body.tipo).toBe("troca");
    await cliente(app).post(`/convite-organizador/${token}`, { nome: "Bia", senha: "senha-nova-da-bia-2" }).expect(200);
    await bia.get("/boloes").expect(401);
    await cliente(app).post("/auth/entrar", { email: "bia@exemplo.com", senha: "senha-da-organizadora-1" }).expect(401);
    await cliente(app).post("/auth/entrar", { email: "bia@exemplo.com", senha: "senha-nova-da-bia-2" }).expect(200);
  });

  it("convite com e-mail já cadastrado dá 409; convite novo invalida o anterior", async () => {
    const adm = await entrarComoAdmin(app);
    await adm.post("/organizadores/convites", { email: "admin@teste.local", nome: "Dup" }).expect(409);
    const a = (await adm.post("/organizadores/convites", { email: "d@exemplo.com", nome: "Davi" })).body as { token: string };
    const b = (await adm.post("/organizadores/convites", { email: "d@exemplo.com", nome: "Davi" })).body as { token: string };
    await cliente(app).get(`/convite-organizador/${a.token}`).expect(404);
    await cliente(app).get(`/convite-organizador/${b.token}`).expect(200);
    // no banco só o hash
    const c = await prisma.conviteOrganizador.findFirstOrThrow({ where: { email: "d@exemplo.com", usadoEm: null }, orderBy: { id: "desc" } });
    expect(c.tokenHash).not.toBe(b.token);
    expect(c.tokenHash).toHaveLength(64);
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
});
