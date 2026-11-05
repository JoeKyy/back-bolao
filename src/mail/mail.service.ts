import { Injectable, Logger } from "@nestjs/common";
import { isIPv4 } from "node:net";
import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../common/config";

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Endereços cujo tráfego NÃO SAI desta máquina: os únicos em que a verificação do certificado do
 * relay é dispensada (mesmo critério do gestor de conteúdo). Em destino público a verificação
 * continua valendo; a exceção é decidida pelo ENDEREÇO, nunca por uma variável que alguém liga
 * "para funcionar" e esquece ligada.
 */
export function relayPrivado(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h === "host.docker.internal" || h === "::1") return true;
  if (!isIPv4(h)) return false; // nome de domínio qualquer (ex.: "127.evil.com") nunca é privado
  const [a, b] = h.split(".").map(Number);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Opções do transporte a partir da URL SMTP. Exportado para teste sem montar transporte. */
export function opcoesDoTransporte(url: string, helo: string | null, servername: string | null) {
  const alvo = new URL(url);
  const seguro = alvo.protocol === "smtps:";
  const tls = servername ? { servername } : relayPrivado(alvo.hostname) ? { rejectUnauthorized: false } : undefined;
  return {
    host: alvo.hostname.replace(/^\[|\]$/g, ""),
    port: Number(alvo.port) || (seguro ? 465 : 25),
    secure: seguro,
    ...(alvo.username ? { auth: { user: decodeURIComponent(alvo.username), pass: decodeURIComponent(alvo.password) } } : {}),
    ...(helo ? { name: helo } : {}),
    ...(tls ? { tls } : {}),
  };
}

/**
 * E-mail transacional (só "esqueci minha senha", por enquanto). Sem SMTP_URL configurado, não
 * envia nada e devolve false. O conteúdo (que leva o link) NUNCA vai para o log (como o AUD-24
 * do gestor): falha registra só o destinatário mascarado.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger("Mail");
  private transporte: Transporter | null | undefined;

  private obter(): Transporter | null {
    if (this.transporte === undefined) {
      const { smtpUrl: url, mailHelo, smtpTlsServername } = config();
      try {
        // Sem a URL no log: ela pode carregar usuário e senha do relay.
        this.transporte = url ? nodemailer.createTransport(opcoesDoTransporte(url, mailHelo, smtpTlsServername)) : null;
      } catch {
        this.log.error("SMTP_URL inválida; o envio de e-mail fica indisponível.");
        this.transporte = null;
      }
    }
    return this.transporte;
  }

  get ativo(): boolean {
    return !!config().smtpUrl;
  }

  async enviar(para: string, assunto: string, paragrafos: string[], acao: { texto: string; url: string }): Promise<boolean> {
    const t = this.obter();
    const mascarado = para.replace(/^(.).*(@.*)$/, "$1***$2");
    if (!t) {
      this.log.warn(`SMTP não configurado; e-mail para ${mascarado} não enviado.`);
      return false;
    }
    const texto = [...paragrafos, "", `${acao.texto}: ${acao.url}`].join("\n");
    const html =
      paragrafos.map((p) => `<p>${escapar(p)}</p>`).join("") +
      `<p><a href="${escapar(acao.url)}">${escapar(acao.texto)}</a></p><p style="color:#666;font-size:12px">${escapar(acao.url)}</p>`;
    try {
      await t.sendMail({ from: config().mailFrom, to: para, subject: assunto, text: texto, html });
      return true;
    } catch (e) {
      this.log.error(`Falha ao enviar e-mail para ${mascarado}: ${e instanceof Error ? e.name : "erro"}`);
      return false;
    }
  }
}
