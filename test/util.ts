import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configurarApp } from "../src/configurar-app";
import { PrismaService } from "../src/prisma/prisma.service";

export const ORIGEM = "http://front.teste";

export async function subirApp() {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configurarApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

/** Limpa os dados (mantém o organizador criado no boot). Só no banco de teste. */
export async function limpar(prisma: PrismaService) {
  if (!/\/bolao_teste(\?|$)/.test(process.env.DATABASE_URL ?? "")) throw new Error("limpar() só no banco de teste");
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Evento","Jogo","DispositivoAcesso","Participante","Bolao","Sessao","Tentativa" RESTART IDENTITY CASCADE`,
  );
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
  await c.post("/auth/entrar", { email: "admin@teste.local", senha: "senha-de-teste-123" }).expect(200);
  return c;
}
