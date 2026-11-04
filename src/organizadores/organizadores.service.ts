import { Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { conflito, invalido, muitasTentativas, naoEncontrado } from "../common/erros";
import { LimitesService, agruparIp } from "../common/limites.service";
import { TOKEN_RE, hashToken, novoTokenSecreto } from "../common/tokens";
import { PrismaService } from "../prisma/prisma.service";
import type { ConviteOrganizadorCriado, ConviteOrganizadorPublico, OrganizadorDTO } from "../shared/tipos";

export const CONVITE_ORG_DIAS = 7;
const CONVITE_JANELA_MS = 10 * 60 * 1000;
const CONVITE_MAX_POR_IP = 20;

@Injectable()
export class OrganizadoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limites: LimitesService,
  ) {}

  async listar(): Promise<OrganizadorDTO[]> {
    const us = await this.prisma.usuario.findMany({ orderBy: { id: "asc" }, include: { _count: { select: { boloes: true } } } });
    return us.map((u) => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      papel: u.papel,
      ativo: u.ativo,
      boloes: u._count.boloes,
      criadoEm: u.criadoEm.toISOString(),
    }));
  }

  private async emitir(email: string, nome: string, usuarioId: number | null): Promise<ConviteOrganizadorCriado> {
    const token = novoTokenSecreto();
    const expiraEm = new Date(Date.now() + CONVITE_ORG_DIAS * 24 * 60 * 60 * 1000);
    await this.prisma.$transaction(async (tx) => {
      // Um convite vivo por e-mail: emitir outro invalida o anterior.
      await tx.conviteOrganizador.updateMany({ where: { email, usadoEm: null }, data: { expiraEm: new Date() } });
      await tx.conviteOrganizador.create({ data: { tokenHash: hashToken(token), email, nome, usuarioId, expiraEm } });
    });
    return { token, expiraEm: expiraEm.toISOString() };
  }

  async convidar(emailBruto: string, nome: string): Promise<ConviteOrganizadorCriado> {
    const email = emailBruto.trim().toLowerCase();
    if (await this.prisma.usuario.findUnique({ where: { email } })) {
      throw conflito("email_em_uso", "Já existe um organizador com este e-mail.");
    }
    return this.emitir(email, nome, null);
  }

  async trocaDeSenha(usuarioId: number): Promise<ConviteOrganizadorCriado> {
    const u = await this.prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!u) throw naoEncontrado("Organizador não encontrado.");
    return this.emitir(u.email, u.nome, u.id);
  }

  async definirAtivo(adminId: number, usuarioId: number, ativo: boolean) {
    if (adminId === usuarioId) throw invalido("propria_conta", "Você não pode desativar a sua própria conta.");
    const u = await this.prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!u) throw naoEncontrado("Organizador não encontrado.");
    await this.prisma.$transaction([
      this.prisma.usuario.update({ where: { id: usuarioId }, data: { ativo } }),
      // Desativar derruba as sessões e os convites pendentes na hora.
      ...(ativo
        ? []
        : [
            this.prisma.sessao.deleteMany({ where: { usuarioId } }),
            this.prisma.conviteOrganizador.updateMany({ where: { email: u.email, usadoEm: null }, data: { expiraEm: new Date() } }),
          ]),
    ]);
  }

  // ---------- público (quem recebeu o link) ----------

  private async conviteValido(token: string, ip: string) {
    if (!(await this.limites.consumir(`convite-org:${agruparIp(ip)}`, CONVITE_MAX_POR_IP, CONVITE_JANELA_MS))) {
      throw muitasTentativas("Muitas tentativas. Aguarde alguns minutos.");
    }
    if (!TOKEN_RE.test(token)) throw naoEncontrado("Convite inválido ou expirado.");
    const c = await this.prisma.conviteOrganizador.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!c || c.usadoEm || c.expiraEm.getTime() <= Date.now()) throw naoEncontrado("Convite inválido ou expirado.");
    return c;
  }

  async verConvite(token: string, ip: string): Promise<ConviteOrganizadorPublico> {
    const c = await this.conviteValido(token, ip);
    return { email: c.email, nome: c.nome, tipo: c.usuarioId ? "troca" : "novo" };
  }

  /** Cria a conta (ou troca a senha) e devolve o id para abrir a sessão. Uso único. */
  async aceitar(token: string, nome: string, senha: string, ip: string): Promise<number> {
    const c = await this.conviteValido(token, ip);
    const senhaHash = await bcrypt.hash(senha, 12);
    return this.prisma.$transaction(async (tx) => {
      // Consome o convite de forma atômica: dois envios simultâneos não criam duas contas.
      const marcado = await tx.conviteOrganizador.updateMany({ where: { id: c.id, usadoEm: null }, data: { usadoEm: new Date() } });
      if (marcado.count !== 1) throw naoEncontrado("Convite inválido ou expirado.");
      if (c.usuarioId) {
        const u = await tx.usuario.findUnique({ where: { id: c.usuarioId } });
        if (!u || !u.ativo) throw naoEncontrado("Convite inválido ou expirado.");
        await tx.usuario.update({ where: { id: u.id }, data: { senhaHash } });
        await tx.sessao.deleteMany({ where: { usuarioId: u.id } });
        return u.id;
      }
      if (await tx.usuario.findUnique({ where: { email: c.email } })) throw conflito("email_em_uso", "Já existe um organizador com este e-mail.");
      const u = await tx.usuario.create({ data: { email: c.email, nome: nome || c.nome, senhaHash, papel: "ORGANIZADOR" } });
      return u.id;
    });
  }
}
