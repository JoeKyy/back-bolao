import { Injectable, Logger } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { exigirSenhaAceitavel } from "../auth/senha";
import { config } from "../common/config";
import { conflito, muitasTentativas, naoEncontrado } from "../common/erros";
import { LimitesService, agruparIp } from "../common/limites.service";
import { TOKEN_RE, hashToken, novoTokenSecreto } from "../common/tokens";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { registrarEvento, travarBolao } from "../boloes/carregar";
import { ConvitesService } from "../usuarios/convites.service";
import type { ContaPedida, VinculoPublico } from "../shared/tipos";

export const VINCULO_HORAS = 48;
const JANELA_IP_MS = 10 * 60 * 1000;
const MAX_POR_IP = 10;
const HORA_MS = 60 * 60 * 1000;
export const MENSAGEM_VINCULO = "Se o e-mail estiver certo, enviamos um link para guardar o bolão na sua conta. Ele vale 48 horas.";

/**
 * "Guardar o bolão numa conta" para quem entrou só pelo aparelho. A participação só vai para a
 * conta depois que o dono do e-mail abre o link (uso único): ninguém enche a conta de outra
 * pessoa com bolões, e a conta nova só nasce na confirmação.
 */
@Injectable()
export class VinculoService {
  private readonly log = new Logger("Vinculo");

  constructor(
    private readonly prisma: PrismaService,
    private readonly limites: LimitesService,
    private readonly mail: MailService,
    private readonly convites: ConvitesService,
  ) {}

  /** Pede o link. Resposta sempre igual: não revela se o e-mail tem conta. */
  async pedir(p: { participanteId: number; nome: string; bolaoNome: string }, emailBruto: string, ip: string): Promise<ContaPedida> {
    if (!(await this.limites.consumir(`vinculo:ip:${agruparIp(ip)}`, MAX_POR_IP, JANELA_IP_MS))) {
      throw muitasTentativas("Muitas tentativas. Aguarde alguns minutos.");
    }
    if (!(await this.limites.consumir(`vinculo:participante:${p.participanteId}`, 5, HORA_MS))) {
      throw muitasTentativas("Muitos pedidos para este bolão. Aguarde um pouco e tente de novo.");
    }
    const email = emailBruto.trim().toLowerCase();
    // Teto por e-mail, em silêncio: não vira ferramenta de spam contra a caixa de entrada de alguém.
    if (await this.limites.consumir(`vinculo:email:${email}`, 3, HORA_MS)) {
      void this.processar(p, email).catch((e) => this.log.warn(`vínculo falhou: ${e instanceof Error ? e.name : "erro"}`));
    }
    return { mensagem: MENSAGEM_VINCULO };
  }

  private async processar(p: { participanteId: number; nome: string; bolaoNome: string }, email: string) {
    const token = novoTokenSecreto();
    const expiraEm = new Date(Date.now() + VINCULO_HORAS * HORA_MS);
    await this.prisma.$transaction(async (tx) => {
      await tx.vinculoConta.updateMany({ where: { participanteId: p.participanteId, usadoEm: null }, data: { usadoEm: new Date() } });
      await tx.vinculoConta.create({ data: { tokenHash: hashToken(token), participanteId: p.participanteId, email, expiraEm } });
    });
    const link = `${config().appUrl}/guardar/${token}`;
    await this.mail.enviar(email, "Bolão da Mega: guarde o seu bolão", {
      titulo: "Guarde o seu bolão na sua conta",
      paragrafos: [
        `Olá, ${p.nome}. Alguém (esperamos que você) pediu para guardar o bolão "${p.bolaoNome}" numa conta com este e-mail. Assim você acessa seus jogos e o Pix de qualquer aparelho, mesmo que limpe o histórico do navegador.`,
      ],
      acao: { texto: "Guardar meu bolão", url: link, mostrarUrl: true },
      rodape: ["O link vale 48 horas e só pode ser usado uma vez.", "Se não foi você, ignore este e-mail: nada será guardado."],
    });
  }

  private async viva(token: string, ip: string) {
    if (!(await this.limites.consumir(`vinculo-ver:${agruparIp(ip)}`, 20, JANELA_IP_MS))) {
      throw muitasTentativas("Muitas tentativas. Aguarde alguns minutos.");
    }
    if (!TOKEN_RE.test(token)) throw naoEncontrado("Link inválido ou expirado.");
    const v = await this.prisma.vinculoConta.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { participante: { include: { bolao: { select: { nome: true, convite: true } } } } },
    });
    if (!v || v.usadoEm || v.expiraEm.getTime() <= Date.now()) throw naoEncontrado("Link inválido ou expirado.");
    return v;
  }

  async ver(token: string, ip: string): Promise<VinculoPublico> {
    const v = await this.viva(token, ip);
    const u = await this.prisma.usuario.findUnique({ where: { email: v.email }, select: { senhaHash: true, ativo: true } });
    return {
      bolao: v.participante.bolao.nome,
      convite: v.participante.bolao.convite,
      nome: v.participante.nome,
      email: v.email,
      contaExiste: !!u && u.ativo && u.senhaHash !== null,
    };
  }

  /**
   * Confirma: conta existente com senha só recebe o bolão; sem conta (ou conta ainda sem senha) a
   * pessoa escolhe a senha e a conta é criada/ativada. Devolve o id da conta; `sessao` diz se o
   * chamador deve abrir sessão (só quando a senha foi definida agora).
   */
  async confirmar(token: string, nome: string, senha: string | undefined, ip: string) {
    const v = await this.viva(token, ip);
    const u = await this.prisma.usuario.findUnique({ where: { email: v.email } });
    if (u && !u.ativo) throw naoEncontrado("Link inválido ou expirado.");
    const contaPronta = !!u && u.senhaHash !== null;
    const nomeFinal = (nome || v.participante.nome).trim();
    let senhaHash: string | null = null;
    if (!contaPronta) {
      exigirSenhaAceitavel(senha ?? "", { email: v.email, nome: nomeFinal });
      senhaHash = await bcrypt.hash(senha!, 12);
    }
    const bolaoId = v.participante.bolaoId;
    const usuarioId = await this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, bolaoId);
      const r = await tx.vinculoConta.updateMany({ where: { id: v.id, usadoEm: null, expiraEm: { gt: new Date() } }, data: { usadoEm: new Date() } });
      if (r.count !== 1) throw naoEncontrado("Link inválido ou expirado.");
      let id: number;
      if (contaPronta) {
        id = u!.id;
      } else if (u) {
        // Conta criada pelo administrador e ainda sem senha: quem prova o e-mail a ativa.
        await tx.usuario.update({ where: { id: u.id }, data: { senhaHash, nome: u.nome || nomeFinal } });
        await tx.sessao.deleteMany({ where: { usuarioId: u.id } });
        await this.convites.revogarTodos(tx, u.id);
        id = u.id;
      } else {
        id = (await tx.usuario.create({ data: { email: v.email, nome: nomeFinal, senhaHash } })).id;
        await tx.eventoConta.create({ data: { usuarioId: id, porId: null, tipo: "conta_criada", descricao: "Conta criada pela própria pessoa ao guardar um bolão." } });
      }
      if (await tx.participante.findFirst({ where: { bolaoId, usuarioId: id } })) throw conflito("ja_na_conta", "Esta conta já participa deste bolão.");
      const atual = await tx.participante.findUniqueOrThrow({ where: { id: v.participanteId }, select: { usuarioId: true, nome: true } });
      if (atual.usuarioId !== null) throw conflito("outra_conta", "Esta participação já está guardada em outra conta.");
      await tx.participante.update({ where: { id: v.participanteId }, data: { usuarioId: id } });
      await registrarEvento(tx, bolaoId, "vinculo_conta", `Participação de ${atual.nome} guardada na conta por confirmação de e-mail.`, { participanteId: v.participanteId });
      await tx.eventoConta.create({ data: { usuarioId: id, porId: null, tipo: "bolao_guardado", descricao: `Bolão "${v.participante.bolao.nome}" guardado na conta pelo link enviado ao e-mail.` } });
      return id;
    });
    return { usuarioId, convite: v.participante.bolao.convite, sessao: !contaPronta };
  }
}
