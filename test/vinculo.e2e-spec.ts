// "Guardar o bolão numa conta" para quem entrou só pelo aparelho (e-mail confirmado + senha própria).
import type { NestExpressApplication } from "@nestjs/platform-express";
import { MailService } from "../src/mail/mail.service";
import type { PrismaService } from "../src/prisma/prisma.service";
import { cliente, entrarComoAdmin, limpar, login, subirApp } from "./util";

describe("guardar o bolão numa conta (VINC)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let enviados: { para: string; assunto: string; url?: string; texto: string }[];
  const DATA = "2099-01-01T13:00:00.000Z";
  const SENHA = "girafa-roxa-teclado-nuvem";

  beforeAll(async () => {
    ({ app, prisma } = await subirApp());
    jest.spyOn(app.get(MailService), "enviar").mockImplementation(async (para, assunto, conteudo) => {
      enviados.push({ para, assunto, url: conteudo.acao?.url, texto: JSON.stringify(conteudo) });
      return true;
    });
  });
  beforeEach(async () => {
    await limpar(prisma);
    enviados = [];
  });
  afterAll(async () => {
    await app.close();
  });

  /** Aguarda o envio assíncrono (a resposta HTTP não espera, como no "esqueci minha senha"). */
  async function aguardarEmail(n = 1) {
    for (let i = 0; i < 100 && enviados.length < n; i++) await new Promise((r) => setTimeout(r, 20));
    return enviados;
  }
  const tokenDe = (url?: string) => url!.split("/guardar/")[1]!;

  async function bolaoComAparelho(nome = "Ana Anonima") {
    const adm = await entrarComoAdmin(app);
    const { id } = (await adm.post("/boloes", { nome: "Do Grupo", tipo: "NORMAL", dataSorteio: DATA })).body as { id: number };
    const conv = (await adm.get(`/boloes/${id}`)).body.bolao.convite as string;
    const aparelho = cliente(app);
    await aparelho.post(`/convites/${conv}/inscricao`, { nome }).expect(200);
    return { adm, id, conv, aparelho };
  }

  it("sem entrar no bolão pelo link não dá para pedir (401), nem com cookie de outro bolão", async () => {
    const { conv, adm } = await bolaoComAparelho();
    await cliente(app).post(`/convites/${conv}/conta`, { email: "x@exemplo.com" }).expect(401);
    const { id: outro } = (await adm.post("/boloes", { nome: "Outro", tipo: "NORMAL", dataSorteio: DATA })).body as { id: number };
    const conv2 = (await adm.get(`/boloes/${outro}`)).body.bolao.convite as string;
    const aparelho = cliente(app);
    await aparelho.post(`/convites/${conv2}/inscricao`, { nome: "Beto" }).expect(200);
    await aparelho.post(`/convites/${conv}/conta`, { email: "x@exemplo.com" }).expect(401);
    expect(await aguardarEmail()).toHaveLength(0);
  });

  it("validação do e-mail e Origin/CSRF", async () => {
    const { conv, aparelho } = await bolaoComAparelho();
    await aparelho.post(`/convites/${conv}/conta`, { email: "isso-nao-e-email" }).expect(400);
    await aparelho.post(`/convites/${conv}/conta`, {}).expect(400);
    await aparelho.agent.post(`/convites/${conv}/conta`).send({ email: "a@exemplo.com" }).expect(403); // sem Origin/X-Bolao
  });

  it("202 com a mesma mensagem para e-mail novo, com conta e inexistente; o e-mail sai só para o informado", async () => {
    const { conv, aparelho, adm } = await bolaoComAparelho();
    await adm.post("/usuarios", { email: "ja@exemplo.com", nome: "Já Tem", tesoureiro: false }).expect(201);
    const a = await aparelho.post(`/convites/${conv}/conta`, { email: "novo@exemplo.com" }).expect(202);
    const b = await aparelho.post(`/convites/${conv}/conta`, { email: "ja@exemplo.com" }).expect(202);
    expect(b.body).toEqual(a.body);
    const lista = await aguardarEmail(2);
    expect(lista.map((m) => m.para).sort()).toEqual(["ja@exemplo.com", "novo@exemplo.com"]);
    expect(JSON.stringify(a.body)).not.toContain("novo@exemplo.com"); // não ecoa a entrada
    expect(lista[0]!.url).toMatch(/\/guardar\/[A-Za-z0-9_-]{20,}$/);
    // no banco só o hash
    const v = await prisma.vinculoConta.findMany();
    expect(v).toHaveLength(2);
    expect(v.every((x) => !lista.some((m) => m.url!.endsWith(x.tokenHash)))).toBe(true);
  });

  it("conta nova: o link mostra o bolão, pede a senha, cria a conta, liga a participação e abre a sessão", async () => {
    const { conv, aparelho, id } = await bolaoComAparelho("Ana Anonima");
    await aparelho.post(`/convites/${conv}/jogos`, { dezenas: [1, 2, 3, 4, 5, 6] }).expect(204);
    await aparelho.post(`/convites/${conv}/conta`, { email: "Ana@Exemplo.com" }).expect(202);
    const token = tokenDe((await aguardarEmail())[0]!.url);

    const outro = cliente(app); // outro aparelho: só o link
    const ver = (await outro.get(`/vinculo/${token}`).expect(200)).body;
    expect(ver).toEqual({ bolao: "Do Grupo", convite: conv, nome: "Ana Anonima", email: "ana@exemplo.com", contaExiste: false, senhaDefinida: false });

    await outro.post(`/vinculo/${token}`, { senha: "curta" }).expect(400); // não consome o token
    await outro.get(`/vinculo/${token}`).expect(200);
    const r = await outro.post(`/vinculo/${token}`, { nome: "Ana Souza", senha: SENHA }).expect(200);
    expect(r.body).toEqual({ convite: conv, sessao: true });

    const u = await prisma.usuario.findUniqueOrThrow({ where: { email: "ana@exemplo.com" } });
    expect(u).toMatchObject({ nome: "Ana Souza", admin: false, tesoureiro: false, ativo: true });
    expect(u.senhaHash).not.toBeNull();
    const p = await prisma.participante.findFirstOrThrow({ where: { bolaoId: id } });
    expect(p.usuarioId).toBe(u.id);
    // sessão aberta: vê o bolão em "Meus bolões" e o painel em qualquer aparelho
    expect(((await outro.get("/participacoes").expect(200)).body as unknown[]).length).toBe(1);
    expect((await outro.get(`/convites/${conv}/painel`).expect(200)).body.meusJogos).toHaveLength(1);
    // e entra de novo com e-mail e senha
    const depois = cliente(app);
    await depois.post("/auth/entrar", login("ana@exemplo.com", SENHA)).expect(200);
    expect(((await depois.get("/participacoes").expect(200)).body as unknown[]).length).toBe(1);
    // trilha da conta
    const tipos = (await prisma.eventoConta.findMany({ where: { usuarioId: u.id } })).map((e) => e.tipo);
    expect(tipos).toEqual(expect.arrayContaining(["conta_criada", "bolao_guardado"]));
  });

  it("link de uso único, vencido ou inventado dá 404", async () => {
    const { conv, aparelho } = await bolaoComAparelho();
    await aparelho.post(`/convites/${conv}/conta`, { email: "ana@exemplo.com" }).expect(202);
    const token = tokenDe((await aguardarEmail())[0]!.url);
    await cliente(app).post(`/vinculo/${token}`, { senha: SENHA }).expect(200);
    await cliente(app).get(`/vinculo/${token}`).expect(404);
    await cliente(app).post(`/vinculo/${token}`, { senha: SENHA }).expect(404);
    await cliente(app).get(`/vinculo/${"x".repeat(43)}`).expect(404);
    await cliente(app).get("/vinculo/curto").expect(404);

    await aparelho.post(`/convites/${conv}/conta`, { email: "outro@exemplo.com" }).expect(409); // já guardada
    // vencido
    const b2 = await bolaoComAparelho("Beto");
    await b2.aparelho.post(`/convites/${b2.conv}/conta`, { email: "beto@exemplo.com" }).expect(202);
    const t2 = tokenDe((await aguardarEmail(2))[1]!.url);
    await prisma.vinculoConta.updateMany({ data: { expiraEm: new Date(Date.now() - 1000) } });
    await cliente(app).get(`/vinculo/${t2}`).expect(404);
  });

  it("e-mail que já tem conta com senha: só liga o bolão, sem abrir sessão", async () => {
    const { conv, aparelho, id, adm } = await bolaoComAparelho("Beto Aparelho");
    const { token: convite } = (await adm.post("/usuarios", { email: "beto@exemplo.com", nome: "Beto", tesoureiro: false }).expect(201)).body as { token: string };
    await cliente(app).post(`/convite-organizador/${convite}`, { senha: SENHA }).expect(200);
    await aparelho.post(`/convites/${conv}/conta`, { email: "beto@exemplo.com" }).expect(202);
    const token = tokenDe((await aguardarEmail())[0]!.url);
    const anon = cliente(app);
    expect((await anon.get(`/vinculo/${token}`).expect(200)).body.contaExiste).toBe(true);
    const r = await anon.post(`/vinculo/${token}`, {}).expect(200); // sem senha
    expect(r.body).toEqual({ convite: conv, sessao: false });
    await anon.get("/participacoes").expect(401); // não abriu sessão
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email: "beto@exemplo.com" } });
    expect((await prisma.participante.findFirstOrThrow({ where: { bolaoId: id } })).usuarioId).toBe(u.id);
    const entra = cliente(app);
    await entra.post("/auth/entrar", login("beto@exemplo.com", SENHA)).expect(200);
    expect(((await entra.get("/participacoes").expect(200)).body as unknown[]).length).toBe(1);
  });

  it("conta criada pelo administrador e ainda sem senha é ativada por quem prova o e-mail", async () => {
    const { conv, aparelho, adm } = await bolaoComAparelho();
    await adm.post("/usuarios", { email: "pend@exemplo.com", nome: "Pendente", tesoureiro: true }).expect(201);
    await aparelho.post(`/convites/${conv}/conta`, { email: "pend@exemplo.com" }).expect(202);
    const token = tokenDe((await aguardarEmail())[0]!.url);
    expect((await cliente(app).get(`/vinculo/${token}`).expect(200)).body.contaExiste).toBe(false);
    await cliente(app).post(`/vinculo/${token}`, {}).expect(400); // precisa escolher a senha
    await cliente(app).post(`/vinculo/${token}`, { senha: SENHA }).expect(200);
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email: "pend@exemplo.com" } });
    expect(u.tesoureiro).toBe(true); // perfil dado pelo admin permanece
    expect(u.senhaHash).not.toBeNull();
  });

  it("conta já participante do bolão: conflito e nada muda; conta desativada não serve", async () => {
    const { conv, aparelho, id, adm } = await bolaoComAparelho("Dupla");
    const { token: cv } = (await adm.post("/usuarios", { email: "dupla@exemplo.com", nome: "Dupla", tesoureiro: false }).expect(201)).body as { token: string };
    await cliente(app).post(`/convite-organizador/${cv}`, { senha: SENHA }).expect(200);
    const logada = cliente(app);
    await logada.post("/auth/entrar", login("dupla@exemplo.com", SENHA)).expect(200);
    await logada.post(`/convites/${conv}/inscricao`, {}).expect(200); // a conta já participa
    await aparelho.post(`/convites/${conv}/conta`, { email: "dupla@exemplo.com" }).expect(202);
    const token = tokenDe((await aguardarEmail())[0]!.url);
    await cliente(app).post(`/vinculo/${token}`, {}).expect(409);
    expect((await prisma.participante.findMany({ where: { bolaoId: id, usuarioId: null } })).length).toBe(1); // o do aparelho segue sem conta

    const u = await prisma.usuario.findUniqueOrThrow({ where: { email: "dupla@exemplo.com" } });
    await prisma.usuario.update({ where: { id: u.id }, data: { ativo: false } });
    await aparelho.post(`/convites/${conv}/conta`, { email: "dupla@exemplo.com" }).expect(202);
    const t2 = tokenDe((await aguardarEmail(2))[1]!.url);
    await cliente(app).post(`/vinculo/${t2}`, {}).expect(404);
  });

  it("pedir de novo invalida o link anterior; teto por e-mail e por participante", async () => {
    const { conv, aparelho } = await bolaoComAparelho();
    await aparelho.post(`/convites/${conv}/conta`, { email: "a@exemplo.com" }).expect(202);
    const t1 = tokenDe((await aguardarEmail())[0]!.url);
    await aparelho.post(`/convites/${conv}/conta`, { email: "a@exemplo.com" }).expect(202);
    const t2 = tokenDe((await aguardarEmail(2))[1]!.url);
    await cliente(app).get(`/vinculo/${t1}`).expect(404);
    await cliente(app).get(`/vinculo/${t2}`).expect(200);
    // 3 por hora por e-mail: o 4º pedido responde igual, mas não envia
    await aparelho.post(`/convites/${conv}/conta`, { email: "a@exemplo.com" }).expect(202);
    await aparelho.post(`/convites/${conv}/conta`, { email: "a@exemplo.com" }).expect(202);
    await new Promise((r) => setTimeout(r, 300));
    expect(enviados).toHaveLength(3);
    // 5 pedidos por participante por hora: o 6º é recusado
    await aparelho.post(`/convites/${conv}/conta`, { email: "b@exemplo.com" }).expect(202);
    await aparelho.post(`/convites/${conv}/conta`, { email: "c@exemplo.com" }).expect(429);
  });

  it("cookie roubado não liga conta sem acesso ao e-mail", async () => {
    const { conv, aparelho, id } = await bolaoComAparelho();
    await aparelho.post(`/convites/${conv}/conta`, { email: "dono@exemplo.com" }).expect(202);
    await aguardarEmail();
    // quem só tem o cookie do aparelho continua sem conta até o dono do e-mail confirmar
    expect((await prisma.participante.findFirstOrThrow({ where: { bolaoId: id } })).usuarioId).toBeNull();
    expect(await prisma.usuario.count({ where: { email: "dono@exemplo.com" } })).toBe(0);
  });

  it("pedido com senha: a conta nasce com ela e só falta confirmar o e-mail", async () => {
    const { conv, aparelho, id } = await bolaoComAparelho("Carla Aparelho");
    await aparelho.post(`/convites/${conv}/conta`, { email: "carla@exemplo.com", senha: "curta" }).expect(400); // recusada na hora
    expect(await aguardarEmail(0)).toHaveLength(0);
    expect(await prisma.vinculoConta.count()).toBe(0);
    await aparelho.post(`/convites/${conv}/conta`, { email: "carla@exemplo.com", senha: SENHA }).expect(202);
    const token = tokenDe((await aguardarEmail())[0]!.url);
    const v = await prisma.vinculoConta.findFirstOrThrow();
    expect(v.senhaHash).toMatch(/^\$2[aby]\$/); // só o hash, nunca a senha
    const outro = cliente(app);
    const ver = (await outro.get(`/vinculo/${token}`).expect(200)).body;
    expect(ver).toMatchObject({ contaExiste: false, senhaDefinida: true });
    const r = await outro.post(`/vinculo/${token}`, {}).expect(200); // sem digitar senha de novo
    expect(r.body.sessao).toBe(true);
    await cliente(app).post("/auth/entrar", login("carla@exemplo.com", SENHA)).expect(200);
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email: "carla@exemplo.com" } });
    expect((await prisma.participante.findFirstOrThrow({ where: { bolaoId: id } })).usuarioId).toBe(u.id);
  });

  describe("link de acesso do organizador", () => {
    const acessoDe = (adm: ReturnType<typeof cliente>, id: number, pid: number) => adm.post(`/boloes/${id}/participantes/${pid}/acesso`);

    it("quem perdeu o cookie recupera a participação pelo link; uso único e GET não consome", async () => {
      const { conv, aparelho, id, adm } = await bolaoComAparelho("Dora Aparelho");
      await aparelho.post(`/convites/${conv}/jogos`, { dezenas: [1, 2, 3, 4, 5, 6] }).expect(204);
      const pid = (await prisma.participante.findFirstOrThrow({ where: { bolaoId: id } })).id;
      const { token, expiraEm } = (await acessoDe(adm, id, pid).expect(201)).body as { token: string; expiraEm: string };
      expect(new Date(expiraEm).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
      const novo = cliente(app); // aparelho novo, sem cookie
      await novo.get(`/convites/${conv}/painel`).expect(401);
      expect((await novo.get(`/acesso/${token}`).expect(200)).body).toEqual({ bolao: "Do Grupo", convite: conv, nome: "Dora Aparelho" });
      await novo.get(`/acesso/${token}`).expect(200); // pré-visualização não gasta o link
      expect((await novo.post(`/acesso/${token}`).expect(200)).body).toEqual({ convite: conv });
      expect((await novo.get(`/convites/${conv}/painel`).expect(200)).body.meusJogos).toHaveLength(1);
      await cliente(app).post(`/acesso/${token}`).expect(404); // já usado
      await cliente(app).get(`/acesso/${token}`).expect(404);
      expect((await prisma.evento.findMany({ where: { bolaoId: id } })).map((e) => e.tipo)).toEqual(expect.arrayContaining(["acesso_emitido", "acesso_recuperado"]));
      // o aparelho antigo continua valendo (não é uma troca, é um segundo aparelho)
      await aparelho.get(`/convites/${conv}/painel`).expect(200);
    });

    it("novo link invalida o anterior; vencido e inventado dão 404", async () => {
      const { id, adm } = await bolaoComAparelho("Edu Aparelho");
      const pid = (await prisma.participante.findFirstOrThrow({ where: { bolaoId: id } })).id;
      const t1 = (await acessoDe(adm, id, pid).expect(201)).body.token as string;
      const t2 = (await acessoDe(adm, id, pid).expect(201)).body.token as string;
      await cliente(app).get(`/acesso/${t1}`).expect(404);
      await cliente(app).get(`/acesso/${t2}`).expect(200);
      await prisma.acessoParticipante.updateMany({ data: { expiraEm: new Date(Date.now() - 1000) } });
      await cliente(app).get(`/acesso/${t2}`).expect(404);
      await cliente(app).get(`/acesso/${"y".repeat(43)}`).expect(404);
    });

    it("só o dono do bolão emite; participante com conta recebe 409; sem login 401", async () => {
      const { id, conv, adm, aparelho } = await bolaoComAparelho("Fabi Aparelho");
      const pid = (await prisma.participante.findFirstOrThrow({ where: { bolaoId: id } })).id;
      await cliente(app).post(`/boloes/${id}/participantes/${pid}/acesso`).expect(401);
      await aparelho.post(`/boloes/${id}/participantes/${pid}/acesso`).expect(401); // participante não emite
      const { token } = (await adm.post("/usuarios", { email: "outra@exemplo.com", nome: "Outra", tesoureiro: true }).expect(201)).body as { token: string };
      await cliente(app).post(`/convite-organizador/${token}`, { senha: SENHA }).expect(200);
      const outra = cliente(app);
      await outra.post("/auth/entrar", login("outra@exemplo.com", SENHA)).expect(200);
      expect([403, 404]).toContain((await outra.post(`/boloes/${id}/participantes/${pid}/acesso`)).status);
      // participação guardada numa conta: o acesso é por e-mail e senha
      await aparelho.post(`/convites/${conv}/conta`, { email: "fabi@exemplo.com", senha: SENHA }).expect(202);
      const t = tokenDe((await aguardarEmail())[0]!.url);
      await cliente(app).post(`/vinculo/${t}`, {}).expect(200);
      await adm.post(`/boloes/${id}/participantes/${pid}/acesso`).expect(409);
      expect((await adm.get(`/boloes/${id}`)).body.participantes[0].temConta).toBe(true);
    });
  });
});
