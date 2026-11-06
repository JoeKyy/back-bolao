import { Injectable } from "@nestjs/common";
import { conflito, muitasTentativas, naoEncontrado } from "../common/erros";
import { LimitesService, agruparIp } from "../common/limites.service";
import { TOKEN_RE, hashToken, novoTokenSecreto } from "../common/tokens";
import { PrismaService } from "../prisma/prisma.service";
import { registrarEvento, travarBolao } from "../boloes/carregar";
import type { AcessoEmitido, AcessoPublico } from "../shared/tipos";

export const ACESSO_DIAS = 7;
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Link de acesso do organizador para quem entrou só pelo aparelho e perdeu o cookie (limpou o
 * histórico, trocou de celular) e nunca guardou o bolão numa conta. O organizador conhece a
 * pessoa, gera o link e manda pelo WhatsApp; abrir e confirmar liga um aparelho novo à mesma
 * participação. Uso único e sem efeito no GET (pré-visualização de mensagem não consome).
 */
@Injectable()
export class AcessoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limites: LimitesService,
  ) {}

  async emitir(bolaoId: number, participanteId: number): Promise<AcessoEmitido> {
    const token = novoTokenSecreto();
    const expiraEm = new Date(Date.now() + ACESSO_DIAS * DIA_MS);
    await this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, bolaoId);
      const p = await tx.participante.findFirst({ where: { id: participanteId, bolaoId } });
      if (!p) throw naoEncontrado("Participante não encontrado.");
      if (p.usuarioId !== null) throw conflito("ja_na_conta", "Esta pessoa já guardou o bolão numa conta: ela entra com e-mail e senha.");
      await tx.acessoParticipante.updateMany({ where: { participanteId, usadoEm: null }, data: { usadoEm: new Date() } });
      await tx.acessoParticipante.create({ data: { tokenHash: hashToken(token), participanteId, expiraEm } });
      await registrarEvento(tx, bolaoId, "acesso_emitido", `Link de acesso gerado para ${p.nome}.`, { participanteId });
    });
    return { token, expiraEm: expiraEm.toISOString() };
  }

  private async viva(token: string, ip: string) {
    if (!(await this.limites.consumir(`acesso:${agruparIp(ip)}`, 20, 10 * 60 * 1000))) {
      throw muitasTentativas("Muitas tentativas. Aguarde alguns minutos.");
    }
    if (!TOKEN_RE.test(token)) throw naoEncontrado("Link inválido ou expirado.");
    const a = await this.prisma.acessoParticipante.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { participante: { include: { bolao: { select: { nome: true, convite: true } } } } },
    });
    if (!a || a.usadoEm || a.expiraEm.getTime() <= Date.now()) throw naoEncontrado("Link inválido ou expirado.");
    return a;
  }

  async ver(token: string, ip: string): Promise<AcessoPublico> {
    const a = await this.viva(token, ip);
    return { bolao: a.participante.bolao.nome, convite: a.participante.bolao.convite, nome: a.participante.nome };
  }

  /** Liga um aparelho novo à participação e devolve o cookie do aparelho (o chamador grava). */
  async confirmar(token: string, ip: string): Promise<{ dispositivo: string; convite: string }> {
    const a = await this.viva(token, ip);
    const dispositivo = novoTokenSecreto();
    await this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, a.participante.bolaoId);
      const r = await tx.acessoParticipante.updateMany({ where: { id: a.id, usadoEm: null, expiraEm: { gt: new Date() } }, data: { usadoEm: new Date() } });
      if (r.count !== 1) throw naoEncontrado("Link inválido ou expirado.");
      const p = await tx.participante.findUniqueOrThrow({ where: { id: a.participanteId }, select: { usuarioId: true, nome: true } });
      if (p.usuarioId !== null) throw conflito("ja_na_conta", "Esta pessoa já guardou o bolão numa conta: entre com e-mail e senha.");
      await tx.dispositivoAcesso.create({ data: { tokenHash: hashToken(dispositivo), participanteId: a.participanteId } });
      await registrarEvento(tx, a.participante.bolaoId, "acesso_recuperado", `${p.nome} recuperou o acesso por link do organizador.`, { participanteId: a.participanteId });
    });
    return { dispositivo, convite: a.participante.bolao.convite };
  }
}
