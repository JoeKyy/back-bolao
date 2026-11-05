import type { CookieOptions } from "express";
import { config } from "./config";

/**
 * Em produção os cookies usam o prefixo __Host- (SEC-07): o navegador só aceita esse cookie se
 * vier com Secure, Path=/ e sem Domain, então outro subdomínio de joekyy.com.br não consegue
 * plantar nem sobrescrever o cookie do bolão.
 */
const nome = (base: string) => (process.env.NODE_ENV === "production" ? `__Host-${base}` : base);

export const COOKIE_SESSAO = nome("bolao_sessao");
export const COOKIE_DISPOSITIVO = nome("bolao_aparelho");
export const COOKIE_ORGANIZADOR = nome("bolao_org");

export const opcoesCookie = (maxAgeMs: number): CookieOptions => ({
  httpOnly: true,
  secure: config().producao,
  sameSite: "lax",
  path: "/",
  maxAge: maxAgeMs,
});
