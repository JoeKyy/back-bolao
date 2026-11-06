// Validação de WhatsApp e e-mail na API (a tela só ajuda; quem barra é aqui).
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { PrismaService } from "../src/prisma/prisma.service";
import { cliente, entrarComoAdmin, limpar, subirApp } from "./util";

describe("contato válido (WhatsApp e e-mail)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const DATA = "2099-01-01T13:00:00.000Z";
  const VALIDOS = ["(11) 91234-5678", "11912345678", "11 9 1234-5678", "+55 11 91234-5678", "5511912345678", "(11) 3333-4444", "1133334444", ""];
  const INVALIDOS = ["119999999999999", "123", "99999-9999", "(00) 91234-5678", "(11) 81234-56789", "11812345678", "abcdefghijk", "(11) 91234-5678 ramal 2"];

  beforeAll(async () => {
    ({ app, prisma } = await subirApp());
  });
  beforeEach(async () => {
    await limpar(prisma);
  });
  afterAll(async () => {
    await app.close();
  });

  async function bolao() {
    const adm = await entrarComoAdmin(app);
    const { id } = (await adm.post("/boloes", { nome: "Do Grupo", tipo: "NORMAL", dataSorteio: DATA })).body as { id: number };
    const conv = (await adm.get(`/boloes/${id}`)).body.bolao.convite as string;
    return { adm, id, conv };
  }

  it("inscrição pelo link: aceita telefones brasileiros e recusa o resto, com o motivo no campo", async () => {
    const { conv } = await bolao();
    for (const [i, whatsapp] of VALIDOS.entries()) {
      await cliente(app).post(`/convites/${conv}/inscricao`, { nome: `Pessoa ${i}`, whatsapp }).expect(200);
    }
    for (const whatsapp of INVALIDOS) {
      const r = await cliente(app).post(`/convites/${conv}/inscricao`, { nome: "Fulano", whatsapp });
      expect(r.status).toBe(400);
      expect(r.body.campos.whatsapp).toBe("Informe o WhatsApp com DDD, como (11) 91234-5678.");
    }
    const eco = await cliente(app).post(`/convites/${conv}/inscricao`, { nome: "Fulano", whatsapp: "ECO-777-ECO" });
    expect(JSON.stringify(eco.body)).not.toContain("ECO-777-ECO"); // não ecoa a entrada
  });

  it("organizador: cadastrar e editar participante usa a mesma regra", async () => {
    const { adm, id } = await bolao();
    await adm.post(`/boloes/${id}/participantes`, { nome: "Ana", whatsapp: "(11) 91234-5678" }).expect(201);
    const r = await adm.post(`/boloes/${id}/participantes`, { nome: "Beto", whatsapp: "119999999999999" });
    expect(r.status).toBe(400);
    expect(r.body.campos.whatsapp).toContain("DDD");
    const pid = (await prisma.participante.findFirstOrThrow({ where: { bolaoId: id } })).id;
    await adm.patch(`/boloes/${id}/participantes/${pid}`, { nome: "Ana", whatsapp: "123" }).expect(400);
    await adm.patch(`/boloes/${id}/participantes/${pid}`, { nome: "Ana", whatsapp: "1133334444" }).expect(204);
  });

  it("e-mail precisa ter domínio válido nos pedidos de conta e de usuário", async () => {
    const { adm, conv } = await bolao();
    const aparelho = cliente(app);
    await aparelho.post(`/convites/${conv}/inscricao`, { nome: "Dora" }).expect(200);
    for (const email of ["a@b", "sem-arroba.com", "a b@exemplo.com", "@exemplo.com", "a@b.c"]) {
      const r = await aparelho.post(`/convites/${conv}/conta`, { email });
      expect(r.status).toBe(400);
      expect(r.body.campos.email).toBe("Informe um e-mail válido, como nome@exemplo.com.");
      expect((await adm.post("/usuarios", { email, nome: "X", tesoureiro: false })).status).toBe(400);
    }
    await aparelho.post(`/convites/${conv}/conta`, { email: "dora@exemplo.com.br" }).expect(202);
  });
});
