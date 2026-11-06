import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import crypto from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configurarApp } from "../src/configurar-app";
import { LoginCriptoService } from "../src/auth/login-cripto.service";
import { PrismaService } from "../src/prisma/prisma.service";

export const ORIGEM = "http://front.teste";

export async function subirApp() {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configurarApp(app);
  await app.init();
  appAtual = app;
  return { app, prisma: app.get(PrismaService) };
}

let appAtual: NestExpressApplication | null = null;

/** Corpo do login como o front manda: senha cifrada com a chave pública da API (RSA-OAEP). */
export function login(email: string, senha: string) {
  if (!appAtual) throw new Error("subirApp() antes de login()");
  const chave = appAtual.get(LoginCriptoService).chavePublica();
  const senhaCifrada = crypto
    .publicEncrypt({ key: chave, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(senha))
    .toString("base64");
  return { email, senhaCifrada };
}

/** Limpa os dados (mantém o organizador criado no boot). Só no banco de teste. */
export async function limpar(prisma: PrismaService) {
  if (!/\/bolao_teste[a-z_]*(\?|$)/.test(process.env.DATABASE_URL ?? "")) throw new Error("limpar() só no banco de teste");
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Evento","Jogo","DispositivoAcesso","Participante","Bolao","Sessao","Tentativa","AparelhoOrganizador","ConviteOrganizador","CodigoRecuperacao","EventoConta","VinculoConta" RESTART IDENTITY CASCADE`,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM "Usuario" WHERE "email" <> 'admin@teste.local'`);
  await prisma.$executeRawUnsafe(`UPDATE "Usuario" SET "admin" = true, "tesoureiro" = true, "ativo" = true WHERE "email" = 'admin@teste.local'`);
}

/** Cliente com cookies (agent) que manda os cabeçalhos do front. */
export function cliente(app: NestExpressApplication) {
  const agent = request.agent(app.getHttpServer());
  const h = (r: request.Test) => r.set("Origin", ORIGEM).set("X-Bolao", "1");
  return {
    agent,
    get: (url: string) => agent.get(url).set("Origin", ORIGEM),
    post: (url: string, body?: object) => h(agent.post(url)).send(body ?? {}),
    patch: (url: string, body?: object) => h(agent.patch(url)).send(body ?? {}),
    del: (url: string) => h(agent.delete(url)),
  };
}

export async function entrarComoAdmin(app: NestExpressApplication) {
  const c = cliente(app);
  await c.post("/auth/entrar", login("admin@teste.local", "senha-de-teste-123")).expect(200);
  return c;
}
