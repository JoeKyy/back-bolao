// Testes dos achados da revalidação de 04/11/2026 (RVAL-01 a RVAL-10).
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { PrismaService } from "../src/prisma/prisma.service";
import { cliente, entrarComoAdmin, limpar, login, subirApp } from "./util";

describe("revalidação (RVAL)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const DATA = "2099-01-01T13:00:00.000Z";
  const SENHA = "senha-da-organizadora-1";

  beforeAll(async () => {
    ({ app, prisma } = await subirApp());
  });
  beforeEach(async () => {
    await limpar(prisma);
  });
  afterAll(async () => {
    await app.close();
  });

  async function criar(email: string, nome: string, perfis: { admin?: boolean; tesoureiro?: boolean } = {}) {
    const adm = await entrarComoAdmin(app);
    const { token } = (await adm.post("/usuarios", { email, nome, ...perfis }).expect(201)).body as { token: string };
    return { adm, token };
  }
  async function conta(email: string, nome: string, perfis: { admin?: boolean; tesoureiro?: boolean } = {}) {
    const { token } = await criar(email, nome, perfis);
    const c = cliente(app);
    await c.post(`/convite-organizador/${token}`, { nome, senha: SENHA }).expect(200);
    return c;
  }
  const idDe = async (email: string) => (await prisma.usuario.findUniqueOrThrow({ where: { email } })).id;

  it("RVAL-01: outra conta no mesmo aparelho não herda a participação guardada em uma conta", async () => {
    const adm = await entrarComoAdmin(app);
    const { id } = (await adm.post("/boloes", { nome: "Do Aparelho", tipo: "NORMAL", dataSorteio: DATA })).body as { id: number };
    const conv = (await adm.get(`/boloes/${id}`)).body.bolao.convite as string;
    await conta("ana@exemplo.com", "Ana");
    await conta("beto@exemplo.com", "Beto");
    const aparelho = cliente(app); // mesmo cookie para as duas contas
    await aparelho.post(`/convites/${conv}/inscricao`, { nome: "Ana Anonima" }).expect(200);
    await aparelho.post("/auth/entrar", login("ana@exemplo.com", SENHA)).expect(200);
    await aparelho.post(`/convites/${conv}/vincular`).expect(204);
    await aparelho.post(`/convites/${conv}/jogos`, { dezenas: [1, 2, 3, 4, 5, 6] }).expect(204);
    await aparelho.post("/auth/sair").expect(200);

    await aparelho.post("/auth/entrar", login("beto@exemplo.com", SENHA)).expect(200);
    await aparelho.get(`/convites/${conv}/painel`).expect(401); // não vê a participação da Ana
    await aparelho.post(`/convites/${conv}/jogos`, { dezenas: [7, 8, 9, 10, 11, 12] }).expect(401);
    // o Beto entra no bolão com a própria conta e fica com a própria participação
    await aparelho.post(`/convites/${conv}/inscricao`, {}).expect(200);
    const painel = (await aparelho.get(`/convites/${conv}/painel`).expect(200)).body;
    expect(painel.eu.nome).toBe("Beto");
    expect(painel.meusJogos).toHaveLength(0);
    expect(await prisma.participante.count({ where: { bolaoId: id } })).toBe(2);
  });

  it("RVAL-02: senha acima de 128 caracteres é recusada com mensagem; 128 entra no login cifrado", async () => {
    const { token } = await criar("longa@exemplo.com", "Longa");
    const r = await cliente(app).post(`/convite-organizador/${token}`, { senha: "a1-".repeat(60) });
    expect(r.status).toBe(400);
    const doze8 = "cavalo-azul-bateria-grampo-".repeat(5).slice(0, 128);
    await cliente(app).post(`/convite-organizador/${token}`, { senha: doze8 }).expect(200);
    await cliente(app).post("/auth/entrar", login("longa@exemplo.com", doze8)).expect(200);
  });

  it("RVAL-03: trocar a senha ou recuperar por código revoga os links pendentes", async () => {
    const bia = await conta("bia@exemplo.com", "Bia");
    const adm = await entrarComoAdmin(app);
    const uid = await idDe("bia@exemplo.com");
    const l1 = (await adm.post(`/usuarios/${uid}/link`).expect(201)).body.token as string;
    await bia.post("/auth/entrar", login("bia@exemplo.com", SENHA)).expect(200);
    await bia.post("/auth/senha", { atual: SENHA, nova: "girafa-roxa-teclado-nuvem" }).expect(200);
    await cliente(app).get(`/convite-organizador/${l1}`).expect(404);

    const b2 = cliente(app);
    await b2.post("/auth/entrar", login("bia@exemplo.com", "girafa-roxa-teclado-nuvem")).expect(200);
    const { codigos } = (await b2.post("/auth/codigos", { senha: "girafa-roxa-teclado-nuvem" }).expect(200)).body as { codigos: string[] };
    const l2 = (await adm.post(`/usuarios/${uid}/link`).expect(201)).body.token as string;
    await cliente(app).post("/auth/recuperar", { email: "bia@exemplo.com", codigo: codigos[0], novaSenha: "outra-girafa-roxa-teclado" }).expect(200);
    await cliente(app).get(`/convite-organizador/${l2}`).expect(404);
  });

  it("RVAL-04: códigos gerados, recuperação por código e 'esqueci' ficam na atividade da conta", async () => {
    const bia = await conta("bia@exemplo.com", "Bia");
    await bia.post("/auth/entrar", login("bia@exemplo.com", SENHA)).expect(200);
    const { codigos } = (await bia.post("/auth/codigos", { senha: SENHA }).expect(200)).body as { codigos: string[] };
    await cliente(app).post("/auth/esqueci", { email: "bia@exemplo.com" }).expect(202);
    const r = cliente(app);
    await r.post("/auth/recuperar", { email: "bia@exemplo.com", codigo: codigos[0], novaSenha: "girafa-roxa-teclado-nuvem" }).expect(200);
    let textos = "";
    for (let i = 0; i < 40 && !textos.includes("página"); i++) {
      textos = ((await r.get("/auth/atividade").expect(200)).body as { descricao: string }[]).map((a) => a.descricao).join(" | ");
      if (!textos.includes("página")) await new Promise((x) => setTimeout(x, 100));
    }
    expect(textos).toContain("Novos códigos de recuperação gerados");
    expect(textos).toContain("Senha trocada com um código de recuperação");
    expect(textos).toContain("Esqueci minha senha");
  });

  it("RVAL-05: administrador com convite pendente não conta como administrador que sobra", async () => {
    const { adm } = await criar("pendente@exemplo.com", "Pendente", { admin: true });
    const meuId = ((await adm.get("/auth/eu")).body as { id: number }).id;
    const r = await adm.patch(`/usuarios/${meuId}/perfis`, { admin: false });
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe("ultimo_admin");
  });

  it("RVAL-07: 'esqueci' não invalida o link que o administrador gerou", async () => {
    const { token } = await criar("bia@exemplo.com", "Bia");
    const antes = await prisma.conviteOrganizador.count();
    await cliente(app).post("/auth/esqueci", { email: "bia@exemplo.com" }).expect(202);
    for (let i = 0; i < 40 && (await prisma.conviteOrganizador.count()) === antes; i++) await new Promise((r) => setTimeout(r, 100));
    expect((await cliente(app).get(`/convite-organizador/${token}`).expect(200)).body.tipo).toBe("novo");
  });

  it("RVAL-10: o mesmo envio cifrado do login não vale duas vezes", async () => {
    await conta("bia@exemplo.com", "Bia");
    const corpo = login("bia@exemplo.com", SENHA);
    await cliente(app).post("/auth/entrar", corpo).expect(200);
    await cliente(app).post("/auth/entrar", corpo).expect(401);
  });
});
