// Leitura única e validada do ambiente. Falta de variável obrigatória derruba o boot com
// mensagem clara, em vez de a API subir e falhar na primeira requisição.

export interface Config {
  producao: boolean;
  porta: number;
  corsOrigins: string[];
  /** Valor para `app.set("trust proxy", ...)`. Vazio: não confia em proxy nenhum. */
  trustProxy: string | false;
  adminEmail: string | null;
  adminSenha: string | null;
  caixaApiUrl: string | null;
}

export const SENHA_MINIMA = 12;

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const producao = env.NODE_ENV === "production";
  const corsOrigins = (env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (producao && corsOrigins.some((o) => !o.startsWith("https://"))) {
    throw new Error("CORS_ORIGINS em produção aceita só origens https://");
  }
  const trust = (env.TRUST_PROXY ?? "").trim();
  const adminSenha = env.ADMIN_PASSWORD?.trim() || null;
  if (adminSenha && adminSenha.length < SENHA_MINIMA) {
    throw new Error(`ADMIN_PASSWORD precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);
  }
  return {
    producao,
    porta: env.PORT ? Number(env.PORT) : 3333,
    corsOrigins,
    trustProxy: trust ? trust : false,
    adminEmail: env.ADMIN_EMAIL?.trim().toLowerCase() || null,
    adminSenha,
    caixaApiUrl: env.CAIXA_API_URL?.trim() || null,
  };
}

let cache: Config | null = null;
export const config = (): Config => (cache ??= lerConfig());
