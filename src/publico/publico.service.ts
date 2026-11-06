import { Injectable } from "@nestjs/common";
import { conflito, invalido, muitasTentativas, naoAutenticado, naoEncontrado, proibido } from "../common/erros";
import { LimitesService, agruparIp } from "../common/limites.service";
import { TOKEN_RE, hashToken, novoTokenSecreto } from "../common/tokens";
import { gerarPix } from "../pix/pix";
import { PrismaService } from "../prisma/prisma.service";
import { formatDezena, precoJogo, validarDezenas } from "../shared/regras";
import type { ConvitePublico, JogoDTO, PainelParticipante, ParticipacaoDTO, ParticipanteDTO } from "../shared/tipos";
import { aceitaApostas, exigirDentroDoTeto, bolaoDTO, carregarBolao, registrarEvento, resumoDe, travarBolao, type BolaoCompleto } from "../boloes/carregar";
import { MAX_JOGOS_POR_BOLAO } from "../boloes/boloes.service";
import { situacaoDe } from "../boloes/resumo";

export const INSCRICAO_JANELA_MS = 10 * 60 * 1000;
export const INSCRICAO_MAX_POR_IP = 10;
export const JOGOS_MAX_POR_PARTICIPANTE = 50;
export const JOGO_JANELA_MS = 10 * 60 * 1000;
export const JOGO_MAX_POR_IP = 60;

const semDono = (j: JogoDTO): JogoDTO => ({ ...j, participanteId: 0 });

/** Quem está pedindo: aparelho (cookie) e, se logado, a conta e o perfil de tesoureiro. */
export interface Identidade {
  dispositivo?: string;
  usuarioId?: number | null;
  tesoureiro?: boolean;
}

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

  /** Participante deste bolão: pela conta logada (se houver) ou pelo aparelho. */
  private async participanteAtual(bolaoId: number, quem: Identidade): Promise<number | null> {
    if (quem.usuarioId) {
      const p = await this.prisma.participante.findFirst({ where: { bolaoId, usuarioId: quem.usuarioId }, select: { id: true } });
      if (p) return p.id;
    }
    return this.participanteDoAparelho(bolaoId, quem.dispositivo, quem.usuarioId ?? null);
  }

  /**
   * Participante deste bolão ligado ao aparelho. RVAL-01: se a participação já está guardada em
   * uma conta, só essa conta a enxerga por aqui; outra conta logada no mesmo aparelho não herda
   * (o painel, o Pix e os jogos são de quem guardou). Sem login, o aparelho que criou continua
   * valendo.
   */
  private async participanteDoAparelho(bolaoId: number, dispositivo: string | undefined, usuarioId: number | null = null) {
    if (!dispositivo || !TOKEN_RE.test(dispositivo)) return null;
    const d = await this.prisma.dispositivoAcesso.findFirst({
      where: {
        tokenHash: hashToken(dispositivo),
        participante: { bolaoId, ...(usuarioId ? { OR: [{ usuarioId: null }, { usuarioId }] } : {}) },
      },
      select: { participanteId: true },
    });
    return d?.participanteId ?? null;
  }

  async convite(convite: string, quem: Identidade): Promise<ConvitePublico> {
    const b = await this.bolaoDoConvite(convite);
    return {
      nome: b.nome,
      tipo: b.tipo,
      concurso: b.concurso,
      dataSorteio: b.dataSorteio?.toISOString() ?? null,
      precoSimples: b.precoSimples,
      inscricoesAbertas: aceitaApostas(b),
      jaInscrito: (await this.participanteAtual(b.id, quem)) !== null,
    };
  }

  /**
   * Inscreve e devolve o token do aparelho. Tudo sob a trava do bolão (SEC-05): checagem do
   * aparelho, limite por IP e teto, para inscrições paralelas não criarem duplicatas.
   * O token do aparelho só é reaproveitado se o servidor já o emitiu (SEC-07).
   * Logado: a participação fica na conta (nome da conta; uma por bolão). Se o aparelho já
   * tinha participação sem conta neste bolão, ela passa a ser da conta.
   */
  async inscrever(convite: string, nome: string, whatsapp: string, ip: string, quem: Identidade) {
    const b = await this.bolaoDoConvite(convite);
    const chave = `inscricao:${b.id}:${agruparIp(ip)}`;
    const dispositivo = quem.dispositivo;
    return this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, b.id);
      const valido = dispositivo && TOKEN_RE.test(dispositivo) ? dispositivo : undefined;
      if (quem.usuarioId) {
        const daConta = await tx.participante.findFirst({ where: { bolaoId: b.id, usuarioId: quem.usuarioId }, select: { id: true } });
        if (daConta) return { dispositivo: valido };
      }
      if (valido) {
        const ja = await tx.dispositivoAcesso.findFirst({
          where: { tokenHash: hashToken(valido), participante: { bolaoId: b.id } },
          select: { participanteId: true, participante: { select: { usuarioId: true } } },
        });
        // Participação guardada em OUTRA conta não conta como "já inscrito" para esta (RVAL-01).
        if (ja && quem.usuarioId && ja.participante.usuarioId !== null && ja.participante.usuarioId !== quem.usuarioId) {
          // segue para criar a participação desta conta
        } else if (ja) {
          if (quem.usuarioId && ja.participante.usuarioId === null) {
            await tx.participante.update({ where: { id: ja.participanteId }, data: { usuarioId: quem.usuarioId } });
            await registrarEvento(tx, b.id, "vinculo_conta", "Participação do aparelho guardada na conta.", { participanteId: ja.participanteId });
          }
          return { dispositivo: valido };
        }
      }
      const atual = await tx.bolao.findUniqueOrThrow({ where: { id: b.id } });
      if (!aceitaApostas(atual)) throw conflito("inscricoes_encerradas", "As inscrições deste bolão estão encerradas.");
      const recentes = await tx.tentativa.count({ where: { chave, criadoEm: { gte: new Date(Date.now() - INSCRICAO_JANELA_MS) } } });
      if (recentes >= INSCRICAO_MAX_POR_IP) throw muitasTentativas("Muitas inscrições deste aparelho. Aguarde alguns minutos.");
      const n = await tx.participante.count({ where: { bolaoId: b.id } });
      if (n >= atual.maxParticipantes) throw conflito("bolao_cheio", "Este bolão atingiu o número máximo de participantes.");

      const conta = quem.usuarioId ? await tx.usuario.findUnique({ where: { id: quem.usuarioId } }) : null;
      const nomeFinal = conta?.nome || nome;
      if (nomeFinal.trim().length < 2) throw invalido("nome", "Informe seu nome.");
      const emitido = valido ? (await tx.dispositivoAcesso.findFirst({ where: { tokenHash: hashToken(valido) }, select: { id: true } })) !== null : false;
      const token = emitido ? valido! : novoTokenSecreto();
      const p = await tx.participante.create({ data: { bolaoId: b.id, nome: nomeFinal, whatsapp, usuarioId: conta?.id ?? null } });
      await tx.dispositivoAcesso.create({ data: { tokenHash: hashToken(token), participanteId: p.id } });
      await tx.tentativa.create({ data: { chave } });
      await registrarEvento(tx, b.id, "inscricao", `${nomeFinal} entrou pelo link de convite${conta ? " (com conta)" : ""}.`, { participanteId: p.id });
      return { dispositivo: token };
    });
  }

  /**
   * Quem é o participante deste aparelho, para pedir "guardar numa conta". Sem aparelho inscrito
   * no bolão, 401 (nada de pedir link para participação alheia). Já guardada em conta: 409.
   */
  async participanteParaConta(convite: string, quem: Identidade) {
    const b = await this.bolaoDoConvite(convite);
    const pid = await this.participanteAtual(b.id, quem);
    if (!pid) throw naoAutenticado("Entre no bolão pelo link de convite.");
    const p = await this.prisma.participante.findUniqueOrThrow({ where: { id: pid }, select: { id: true, nome: true, usuarioId: true } });
    if (p.usuarioId !== null) throw conflito("ja_na_conta", "Esta participação já está guardada em uma conta.");
    return { participanteId: p.id, nome: p.nome, bolaoNome: b.nome };
  }

  /** Guarda na conta logada a participação que este aparelho tem no bolão. */
  async vincular(convite: string, quem: Identidade) {
    if (!quem.usuarioId) throw naoAutenticado("Entre na sua conta para guardar o bolão.");
    const b = await this.bolaoDoConvite(convite);
    await this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, b.id);
      if (await tx.participante.findFirst({ where: { bolaoId: b.id, usuarioId: quem.usuarioId! } })) {
        throw conflito("ja_na_conta", "Sua conta já participa deste bolão.");
      }
      const pid = await this.participanteDoAparelho(b.id, quem.dispositivo);
      if (!pid) throw naoAutenticado("Entre no bolão pelo link de convite.");
      const p = await tx.participante.findUniqueOrThrow({ where: { id: pid } });
      if (p.usuarioId !== null) throw conflito("outra_conta", "Esta participação já está guardada em outra conta.");
      await tx.participante.update({ where: { id: pid }, data: { usuarioId: quem.usuarioId } });
      await registrarEvento(tx, b.id, "vinculo_conta", `Participação de ${p.nome} guardada na conta.`, { participanteId: pid });
    });
  }

  /**
   * "Meus bolões": tudo de que a conta participa, com a situação de cada um. RVAL-09: por
   * agregação no banco (como a lista do tesoureiro, BAUD-06); só bolão com resultado lançado
   * carrega o resumo completo, porque a parte do prêmio depende do rateio. Máximo de 50.
   */
  async participacoes(usuarioId: number): Promise<ParticipacaoDTO[]> {
    const linhas = await this.prisma.$queryRaw<{ pid: number; bolaoId: number; valorPago: number; combos: bigint; njogos: number }[]>`
      SELECT p.id AS pid, p."bolaoId", p."valorPago",
             COALESCE(d.combos, 0)::bigint AS combos, COALESCE(d.n, 0)::int AS njogos
      FROM "Participante" p
      LEFT JOIN LATERAL (
        SELECT SUM((ARRAY[0,0,0,0,0,0,1,7,28,84,210,462,924,1716,3003,5005,8008,12376,18564,27132,38760])[cardinality(j.dezenas) + 1])::bigint AS combos,
               COUNT(*)::int AS n
        FROM "Jogo" j WHERE j."participanteId" = p.id
      ) d ON true
      WHERE p."usuarioId" = ${usuarioId}
      ORDER BY p.id DESC LIMIT 50`;
    if (linhas.length === 0) return [];
    const boloes = new Map(
      (
        await this.prisma.bolao.findMany({
          where: { id: { in: linhas.map((l) => l.bolaoId) } },
          select: { id: true, convite: true, nome: true, tipo: true, concurso: true, dataSorteio: true, precoSimples: true, resultadoDezenas: true },
        })
      ).map((b) => [b.id, b]),
    );
    const out: ParticipacaoDTO[] = [];
    for (const l of linhas) {
      const b = boloes.get(l.bolaoId)!;
      const devido = Number(l.combos) * b.precoSimples;
      const temResultado = b.resultadoDezenas.length === 6;
      let parte: number | null = null;
      if (temResultado) {
        const cheio = await carregarBolao(this.prisma, b.id);
        parte = resumoDe(cheio).participantes.find((x) => x.id === l.pid)?.parte ?? null;
      }
      out.push({
        convite: b.convite,
        nome: b.nome,
        tipo: b.tipo,
        concurso: b.concurso,
        dataSorteio: b.dataSorteio?.toISOString() ?? null,
        situacao: situacaoDe(devido, l.valorPago),
        devido,
        pago: l.valorPago,
        jogos: l.njogos,
        temResultado,
        parte,
      });
    }
    return out;
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
      acesso: null,
    };
  }

  /** `organizadorId`: quem está logado como organizador; só o DONO deste bolão tem a visão de organizador. */
  /** Só o DONO do bolão, com perfil de tesoureiro, tem a visão de organizador. */
  async painel(convite: string, quem: Identidade): Promise<PainelParticipante> {
    const b0 = await this.bolaoDoConvite(convite);
    const ehOrganizador = !!quem.usuarioId && !!quem.tesoureiro && b0.donoId === quem.usuarioId;
    const meuId = await this.participanteAtual(b0.id, quem);
    if (!meuId && !ehOrganizador) throw naoAutenticado("Entre no bolão pelo link de convite.");
    const b = await carregarBolao(this.prisma, b0.id);
    const painel = this.montarPainel(b, meuId, !meuId && ehOrganizador);
    const minha = meuId ? b.participantes.find((p) => p.id === meuId) : undefined;
    painel.acesso = minha ? (minha.usuarioId ? "conta" : "aparelho") : null;
    return painel;
  }

  private async exigirParticipante(convite: string, quem: Identidade) {
    const b = await this.bolaoDoConvite(convite);
    const meuId = await this.participanteAtual(b.id, quem);
    if (!meuId) throw naoAutenticado("Entre no bolão pelo link de convite.");
    return { b, meuId };
  }

  async adicionarJogo(convite: string, quem: Identidade, dezenas: number[], surpresinha: boolean, ip: string) {
    const { b, meuId } = await this.exigirParticipante(convite, quem);
    const v = validarDezenas(dezenas, { min: 6, max: b.maxDezenasParticipante });
    if (!v.ok) throw invalido("jogo_invalido", v.erro);
    if (!(await this.limites.consumir(`jogo:${agruparIp(ip)}`, JOGO_MAX_POR_IP, JOGO_JANELA_MS))) {
      throw muitasTentativas("Muitos jogos em pouco tempo. Aguarde alguns minutos.");
    }
    await this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, b.id);
      const atual = await tx.bolao.findUniqueOrThrow({ where: { id: b.id } });
      if (!aceitaApostas(atual)) throw conflito("inscricoes_encerradas", "As inscrições estão encerradas; não dá para incluir jogos.");
      await exigirDentroDoTeto(tx, meuId, atual.precoSimples, [v.dezenas]);
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

  async removerJogo(convite: string, quem: Identidade, jogoId: number) {
    const { b, meuId } = await this.exigirParticipante(convite, quem);
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
