import { Injectable, Logger } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { conflito, naoEncontrado } from "../common/erros";
import { exigirSenhaAceitavel } from "../auth/senha";
import { PrismaService, type Tx } from "../prisma/prisma.service";
import type { ConviteOrganizadorCriado, ConviteOrganizadorPublico, UsuarioDTO } from "../shared/tipos";
import { ConvitesService } from "./convites.service";

export interface Perfis {
  admin?: boolean;
  tesoureiro?: boolean;
}

/**
 * Contas no esquema do gestor: o administrador cria a conta (nome, e-mail e perfis), ela fica
 * pendente até a pessoa definir a senha pelo link, e os perfis podem ser alterados depois.
 * Perfis combináveis: admin (contas) e tesoureiro (bolões); sem nenhum é pessoa comum.
 * Regra fixa: sempre existe ao menos um administrador ativo.
 */
@Injectable()
export class UsuariosService {
  private readonly log = new Logger("Usuarios");

  constructor(
    private readonly prisma: PrismaService,
    private readonly convites: ConvitesService,
  ) {}

  async listar(): Promise<UsuarioDTO[]> {
    const us = await this.prisma.usuario.findMany({
      orderBy: { id: "asc" },
      include: { _count: { select: { boloes: true, participacoes: true } } },
    });
    return us.map((u) => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      admin: u.admin,
      tesoureiro: u.tesoureiro,
      ativo: u.ativo,
      pendente: u.senhaHash === null,
      boloes: u._count.boloes,
      participacoes: u._count.participacoes,
      criadoEm: u.criadoEm.toISOString(),
    }));
  }

  async criar(emailBruto: string, nome: string, perfis: Perfis): Promise<ConviteOrganizadorCriado> {
    const email = emailBruto.trim().toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      if (await tx.usuario.findUnique({ where: { email } })) throw conflito("email_em_uso", "Já existe uma conta com este e-mail.");
      const u = await tx.usuario.create({
        data: { email, nome, admin: !!perfis.admin, tesoureiro: !!perfis.tesoureiro, senhaHash: null },
      });
      const { token, expiraEm } = await this.convites.emitir(u.id, tx);
      return { token, expiraEm: expiraEm.toISOString() };
    });
  }

  /** Trava global de contas: serializa mudanças que podem zerar os administradores. */
  private async travarContas(tx: Tx) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('contas'))::text`;
  }

  private async restariaAdmin(tx: Tx, semEste: number): Promise<boolean> {
    return (await tx.usuario.count({ where: { admin: true, ativo: true, id: { not: semEste } } })) > 0;
  }

  async alterarPerfis(quemPede: number, usuarioId: number, perfis: Perfis) {
    await this.prisma.$transaction(async (tx) => {
      await this.travarContas(tx);
      const u = await tx.usuario.findUnique({ where: { id: usuarioId } });
      if (!u) throw naoEncontrado("Usuário não encontrado.");
      const admin = perfis.admin ?? u.admin;
      const tesoureiro = perfis.tesoureiro ?? u.tesoureiro;
      if (u.admin && !admin && u.ativo && !(await this.restariaAdmin(tx, u.id))) {
        throw conflito("ultimo_admin", "É preciso ter ao menos um administrador ativo. Dê o perfil a outra pessoa antes.");
      }
      await tx.usuario.update({ where: { id: usuarioId }, data: { admin, tesoureiro } });
      this.log.log(
        `Perfis da conta ${usuarioId} alterados por ${quemPede}: admin ${u.admin}->${admin}, tesoureiro ${u.tesoureiro}->${tesoureiro}.`,
      );
    });
  }

  /** Novo link: convite (conta pendente) ou troca de senha (conta com senha). */
  async link(usuarioId: number): Promise<ConviteOrganizadorCriado> {
    const u = await this.prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!u) throw naoEncontrado("Usuário não encontrado.");
    if (!u.ativo) throw conflito("desativado", "Reative a conta antes de gerar um link.");
    const { token, expiraEm } = await this.convites.emitir(u.id);
    return { token, expiraEm: expiraEm.toISOString() };
  }

  async definirAtivo(quemPede: number, usuarioId: number, ativo: boolean) {
    await this.prisma.$transaction(async (tx) => {
      await this.travarContas(tx);
      const u = await tx.usuario.findUnique({ where: { id: usuarioId } });
      if (!u) throw naoEncontrado("Usuário não encontrado.");
      if (!ativo && quemPede === usuarioId) throw conflito("propria_conta", "Você não pode desativar a sua própria conta.");
      if (!ativo && u.admin && !(await this.restariaAdmin(tx, u.id))) {
        throw conflito("ultimo_admin", "É preciso ter ao menos um administrador ativo.");
      }
      await tx.usuario.update({ where: { id: usuarioId }, data: { ativo } });
      if (!ativo) {
        // Desativar derruba as sessões e os links pendentes na hora.
        await tx.sessao.deleteMany({ where: { usuarioId } });
        await tx.conviteOrganizador.updateMany({ where: { usuarioId, usadoEm: null }, data: { usadoEm: new Date() } });
      }
    });
  }

  // ---------- público (quem recebeu o link) ----------

  async verConvite(token: string, ip: string): Promise<ConviteOrganizadorPublico> {
    const c = await this.convites.validar(token, ip);
    return { email: c.usuario.email, nome: c.usuario.nome, tipo: c.usuario.senhaHash === null ? "novo" : "troca" };
  }

  /** Define a senha (e o nome, se for conta nova). Uso único; derruba sessões antigas. */
  async aceitar(token: string, nome: string, senha: string, ip: string): Promise<number> {
    const c = await this.convites.validar(token, ip);
    const novo = c.usuario.senhaHash === null;
    const nomeFinal = novo && nome ? nome : c.usuario.nome;
    exigirSenhaAceitavel(senha, { email: c.usuario.email, nome: nomeFinal });
    const senhaHash = await bcrypt.hash(senha, 12);
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.convites.consumir(tx, c.id))) throw naoEncontrado("Convite inválido ou expirado.");
      await tx.usuario.update({ where: { id: c.usuarioId }, data: { senhaHash, nome: nomeFinal } });
      await tx.sessao.deleteMany({ where: { usuarioId: c.usuarioId } });
      return c.usuarioId;
    });
  }
}
