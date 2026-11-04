import { Injectable } from "@nestjs/common";
import { conflito, invalido, muitasTentativas, naoAutenticado, naoEncontrado, proibido } from "../common/erros";
import { LimitesService, agruparIp } from "../common/limites.service";
import { TOKEN_RE, hashToken, novoTokenSecreto } from "../common/tokens";
import { gerarPix } from "../pix/pix";
import { PrismaService } from "../prisma/prisma.service";
import { formatDezena, precoJogo, validarDezenas } from "../shared/regras";
import type { ConvitePublico, JogoDTO, PainelParticipante, ParticipanteDTO } from "../shared/tipos";
import { aceitaApostas, bolaoDTO, carregarBolao, registrarEvento, resumoDe, travarBolao, type BolaoCompleto } from "../boloes/carregar";
import { MAX_JOGOS_POR_BOLAO } from "../boloes/boloes.service";

export const INSCRICAO_JANELA_MS = 10 * 60 * 1000;
export const INSCRICAO_MAX_POR_IP = 10;
export const JOGOS_MAX_POR_PARTICIPANTE = 50;
export const JOGO_JANELA_MS = 10 * 60 * 1000;
export const JOGO_MAX_POR_IP = 60;

const semDono = (j: JogoDTO): JogoDTO => ({ ...j, participanteId: 0 });

@Injectable()
export class PublicoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limites: LimitesService,
  ) {}

  private async bolaoDoConvite(convite: string) {
    if (!TOKEN_RE.test(convite)) throw naoEncontrado("Convite inválido ou expirado.");
    const b = await this.prisma.bolao.findUnique({ where: { convite } });
    if (!b) throw naoEncontrado("Convite inválido ou expirado.");
    return b;
  }

  /** Participante deste bolão ligado ao aparelho, ou null. */
  private async participanteDoAparelho(bolaoId: number, dispositivo: string | undefined) {
    if (!dispositivo || !TOKEN_RE.test(dispositivo)) return null;
    const d = await this.prisma.dispositivoAcesso.findFirst({
      where: { tokenHash: hashToken(dispositivo), participante: { bolaoId } },
      select: { participanteId: true },
    });
    return d?.participanteId ?? null;
  }

  async convite(convite: string, dispositivo: string | undefined): Promise<ConvitePublico> {
    const b = await this.bolaoDoConvite(convite);
    return {
      nome: b.nome,
      tipo: b.tipo,
      concurso: b.concurso,
      dataSorteio: b.dataSorteio?.toISOString() ?? null,
      precoSimples: b.precoSimples,
      inscricoesAbertas: aceitaApostas(b),
      jaInscrito: (await this.participanteDoAparelho(b.id, dispositivo)) !== null,
    };
  }

  /**
   * Inscreve e devolve o token do aparelho. Tudo sob a trava do bolão (SEC-05): checagem do
   * aparelho, limite por IP e teto, para inscrições paralelas não criarem duplicatas.
   * O token do aparelho só é reaproveitado se o servidor já o emitiu (SEC-07).
   */
  async inscrever(convite: string, nome: string, whatsapp: string, ip: string, dispositivo: string | undefined) {
    const b = await this.bolaoDoConvite(convite);
    const chave = `inscricao:${b.id}:${agruparIp(ip)}`;
    return this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, b.id);
      const valido = dispositivo && TOKEN_RE.test(dispositivo) ? dispositivo : undefined;
      if (valido) {
        const ja = await tx.dispositivoAcesso.findFirst({
          where: { tokenHash: hashToken(valido), participante: { bolaoId: b.id } },
          select: { id: true },
        });
        if (ja) return { dispositivo: valido };
      }
      const atual = await tx.bolao.findUniqueOrThrow({ where: { id: b.id } });
      if (!aceitaApostas(atual)) throw conflito("inscricoes_encerradas", "As inscrições deste bolão estão encerradas.");
      const recentes = await tx.tentativa.count({ where: { chave, criadoEm: { gte: new Date(Date.now() - INSCRICAO_JANELA_MS) } } });
      if (recentes >= INSCRICAO_MAX_POR_IP) throw muitasTentativas("Muitas inscrições deste aparelho. Aguarde alguns minutos.");
      const n = await tx.participante.count({ where: { bolaoId: b.id } });
      if (n >= atual.maxParticipantes) throw conflito("bolao_cheio", "Este bolão atingiu o número máximo de participantes.");

      const emitido = valido ? (await tx.dispositivoAcesso.findFirst({ where: { tokenHash: hashToken(valido) }, select: { id: true } })) !== null : false;
      const token = emitido ? valido! : novoTokenSecreto();
      const p = await tx.participante.create({ data: { bolaoId: b.id, nome, whatsapp } });
      await tx.dispositivoAcesso.create({ data: { tokenHash: hashToken(token), participanteId: p.id } });
      await tx.tentativa.create({ data: { chave } });
      await registrarEvento(tx, b.id, "inscricao", `${nome} entrou pelo link de convite.`, { participanteId: p.id });
      return { dispositivo: token };
    });
  }

  private montarPainel(b: BolaoCompleto, meuId: number | null, visaoOrganizador: boolean): PainelParticipante {
    const r = resumoDe(b);
    const publicos: ParticipanteDTO[] = r.participantes.map((p) => ({
      id: p.id,
      nome: p.nome,
      devido: p.devido,
      pago: p.pago,
      situacao: p.situacao,
      parte: p.parte,
    }));
    const jogosPub: JogoDTO[] = r.jogos.map((j) => ({
      id: j.id,
      participanteId: j.participanteId,
      dezenas: j.dezenas,
      preco: j.preco,
      surpresinha: j.surpresinha,
      registrado: j.registrado,
      conferencia: j.conferencia,
    }));
    const eu = meuId ? publicos.find((p) => p.id === meuId) ?? null : null;
    const falta = eu ? eu.devido - eu.pago : 0;
    const pix =
      eu && falta > 0 && b.pixChave
        ? (() => {
            const identificador = `BOL${b.id}P${eu.id}`;
            return {
              valor: falta,
              identificador,
              copiaECola: gerarPix({
                chave: b.pixChave,
                nome: b.pixNome ?? "",
                cidade: b.pixCidade ?? "",
                valor: falta,
                identificador,
                descricao: `Bolao ${b.nome}`,
              }),
            };
          })()
        : null;
    return {
      bolao: bolaoDTO(b),
      eu,
      visaoOrganizador,
      pix,
      meusJogos: eu ? jogosPub.filter((j) => j.participanteId === eu.id) : [],
      jogos: jogosPub.map(semDono),
      participantes: publicos,
      totais: r.totais,
      chance: r.chance,
    };
  }

  async painel(convite: string, dispositivo: string | undefined, ehOrganizador: boolean): Promise<PainelParticipante> {
    const b0 = await this.bolaoDoConvite(convite);
    const meuId = await this.participanteDoAparelho(b0.id, dispositivo);
    if (!meuId && !ehOrganizador) throw naoAutenticado("Entre no bolão pelo link de convite.");
    const b = await carregarBolao(this.prisma, b0.id);
    return this.montarPainel(b, meuId, !meuId && ehOrganizador);
  }

  private async exigirParticipante(convite: string, dispositivo: string | undefined) {
    const b = await this.bolaoDoConvite(convite);
    const meuId = await this.participanteDoAparelho(b.id, dispositivo);
    if (!meuId) throw naoAutenticado("Entre no bolão pelo link de convite.");
    return { b, meuId };
  }

  async adicionarJogo(convite: string, dispositivo: string | undefined, dezenas: number[], surpresinha: boolean, ip: string) {
    const { b, meuId } = await this.exigirParticipante(convite, dispositivo);
    const v = validarDezenas(dezenas, { min: 6, max: b.maxDezenasParticipante });
    if (!v.ok) throw invalido("jogo_invalido", v.erro);
    if (!(await this.limites.consumir(`jogo:${agruparIp(ip)}`, JOGO_MAX_POR_IP, JOGO_JANELA_MS))) {
      throw muitasTentativas("Muitos jogos em pouco tempo. Aguarde alguns minutos.");
    }
    await this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, b.id);
      const atual = await tx.bolao.findUniqueOrThrow({ where: { id: b.id } });
      if (!aceitaApostas(atual)) throw conflito("inscricoes_encerradas", "As inscrições estão encerradas; não dá para incluir jogos.");
      const meus = await tx.jogo.count({ where: { participanteId: meuId } });
      if (meus >= JOGOS_MAX_POR_PARTICIPANTE) throw conflito("limite_jogos", "Você atingiu o limite de jogos por participante.");
      if ((await tx.jogo.count({ where: { bolaoId: b.id } })) >= MAX_JOGOS_POR_BOLAO) {
        throw conflito("limite_jogos", "Limite de jogos do bolão atingido.");
      }
      await tx.jogo.create({ data: { bolaoId: b.id, participanteId: meuId, dezenas: v.dezenas, surpresinha } });
      const p = await tx.participante.findUniqueOrThrow({ where: { id: meuId } });
      await registrarEvento(
        tx,
        b.id,
        "jogo_participante",
        `${p.nome} incluiu ${surpresinha ? "uma surpresinha" : "um jogo"}: ${v.dezenas.map(formatDezena).join(" ")} (${v.dezenas.length} dezenas).`,
        { participanteId: meuId, dezenas: v.dezenas },
      );
    });
  }

  async removerJogo(convite: string, dispositivo: string | undefined, jogoId: number) {
    const { b, meuId } = await this.exigirParticipante(convite, dispositivo);
    await this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, b.id);
      const atual = await carregarBolao(tx, b.id);
      const j = atual.jogos.find((x) => x.id === jogoId);
      // Jogo de outro participante responde igual a jogo inexistente.
      if (!j || j.participanteId !== meuId) throw naoEncontrado("Jogo não encontrado.");
      if (!aceitaApostas(atual)) throw conflito("inscricoes_encerradas", "As inscrições estão encerradas; fale com o organizador.");
      if (j.registrado) throw proibido("Este jogo já foi registrado na Caixa; fale com o organizador.");
      const eu = resumoDe(atual).participantes.find((p) => p.id === meuId)!;
      const preco = precoJogo(j.dezenas.length, atual.precoSimples);
      if (eu.pago > 0 && eu.devido - preco < eu.pago) {
        throw conflito("jogo_pago", "Este jogo já está pago; para trocar, fale com o organizador.");
      }
      await tx.jogo.delete({ where: { id: jogoId } });
      await registrarEvento(tx, b.id, "jogo_removido", `${eu.nome} removeu o jogo ${j.dezenas.map(formatDezena).join(" ")}.`, {
        participanteId: meuId,
        jogoId,
      });
    });
  }
}
