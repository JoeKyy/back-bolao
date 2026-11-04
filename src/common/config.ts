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
  /** SMTP para "esqueci minha senha" (ex.: smtps://<usuario>:<senha>@<servidor-smtp>:465). */
  smtpUrl: string | null;
  mailFrom: string;
  /** Endereço público do front, para montar os links dos e-mails. */
  appUrl: string;
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
    smtpUrl: env.SMTP_URL?.trim() || null,
    mailFrom: env.MAIL_FROM?.trim() || "Bolão da Mega <nao-responda@joekyy.com.br>",
    appUrl: (env.APP_URL?.trim() || corsOrigins[0] || "http://localhost:3000").replace(/\/$/, ""),
  };
}

let cache: Config | null = null;
export const config = (): Config => (cache ??= lerConfig());
