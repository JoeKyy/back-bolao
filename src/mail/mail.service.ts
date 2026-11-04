import { Injectable, Logger } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../common/config";

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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
      const url = config().smtpUrl;
      this.transporte = url ? nodemailer.createTransport(url) : null;
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
