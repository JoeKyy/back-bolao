import { Injectable } from "@nestjs/common";
import { muitasTentativas, naoEncontrado } from "../common/erros";
import { LimitesService, agruparIp } from "../common/limites.service";
import { TOKEN_RE, hashToken, novoTokenSecreto } from "../common/tokens";
import type { Tx } from "../prisma/prisma.service";
import { PrismaService } from "../prisma/prisma.service";

export const CONVITE_DIAS = 7;
const JANELA_MS = 10 * 60 * 1000;
const MAX_POR_IP = 20;

/**
 * Link de uso único para definir a senha, no esquema do gestor (InviteService): o mesmo link
 * ativa a conta nova e serve de "trocar senha" para conta existente. Emitir um novo invalida os
 * anteriores da mesma conta. No banco, só o sha256.
 */
@Injectable()
export class ConvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limites: LimitesService,
  ) {}

  async emitir(usuarioId: number, tx?: Tx): Promise<{ token: string; expiraEm: Date }> {
    const token = novoTokenSecreto();
    const expiraEm = new Date(Date.now() + CONVITE_DIAS * 24 * 60 * 60 * 1000);
    const gravar = async (db: Tx) => {
      await db.conviteOrganizador.updateMany({ where: { usuarioId, usadoEm: null }, data: { usadoEm: new Date() } });
      await db.conviteOrganizador.create({ data: { tokenHash: hashToken(token), usuarioId, expiraEm } });
    };
    if (tx) await gravar(tx);
    else await this.prisma.$transaction(gravar);
    return { token, expiraEm };
  }

  /** Convite vivo (não usado, não vencido) de conta ativa, ou 404. Limite por IP. */
  async validar(token: string, ip: string) {
    if (!(await this.limites.consumir(`convite-org:${agruparIp(ip)}`, MAX_POR_IP, JANELA_MS))) {
      throw muitasTentativas("Muitas tentativas. Aguarde alguns minutos.");
    }
    if (!TOKEN_RE.test(token)) throw naoEncontrado("Convite inválido ou expirado.");
    const c = await this.prisma.conviteOrganizador.findUnique({ where: { tokenHash: hashToken(token) }, include: { usuario: true } });
    if (!c || c.usadoEm || c.expiraEm.getTime() <= Date.now() || !c.usuario.ativo) throw naoEncontrado("Convite inválido ou expirado.");
    return c;
  }

  /** Marca como usado de forma atômica; false se outro pedido usou antes. */
  async consumir(tx: Tx, id: number): Promise<boolean> {
    const r = await tx.conviteOrganizador.updateMany({ where: { id, usadoEm: null, expiraEm: { gt: new Date() } }, data: { usadoEm: new Date() } });
    return r.count === 1;
  }
}
