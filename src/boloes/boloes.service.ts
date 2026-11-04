import { Injectable } from "@nestjs/common";
import { conflito, invalido, naoEncontrado } from "../common/erros";
import { novoConvite } from "../common/tokens";
import { CaixaService } from "../caixa/caixa.service";
import { normalizarChave } from "../pix/pix";
import { PrismaService } from "../prisma/prisma.service";
import { formatBRL, formatDezena, validarDezenas } from "../shared/regras";
import type { BolaoNaLista, EventoDTO, ResumoAdmin } from "../shared/tipos";
import { bolaoAdminDTO, carregarBolao, registrarEvento, resumoDe, travarBolao } from "./carregar";
import type {
  AtualizarBolaoDto,
  CriarBolaoDto,
  JogosDto,
  PagamentoDto,
  ParticipanteDto,
  RegistroJogoDto,
  ResultadoManualDto,
} from "./dto";

/** Mega da Virada 2026: sorteio em 01/01/2027 às 10h de Brasília (13h UTC). */
export const VIRADA_2026 = { nome: "Mega da Virada 2026", dataSorteio: new Date("2027-01-01T13:00:00Z"), estimativa: 100_000_000_000 };

export const MAX_JOGOS_POR_BOLAO = 2000;

/** Neutraliza fórmula em planilha (=, +, -, @, tab, CR) e escapa aspas. */
export function celulaCsv(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

@Injectable()
export class BoloesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly caixa: CaixaService,
  ) {}

  async listar(): Promise<BolaoNaLista[]> {
    const bs = await this.prisma.bolao.findMany({
      orderBy: { id: "desc" },
      include: { participantes: true, jogos: true },
    });
    return bs.map((b) => {
      const r = resumoDe(b);
      return {
        id: b.id,
        nome: b.nome,
        tipo: b.tipo,
        concurso: b.concurso,
        inscricoesAbertas: b.inscricoesAbertas,
        participantes: b.participantes.length,
        quitados: r.participantes.filter((p) => p.situacao === "quitado").length,
        arrecadado: r.totais.arrecadado,
        jogos: b.jogos.length,
        temResultado: r.totais.premioBolao !== null,
      };
    });
  }

  async criar(dto: CriarBolaoDto): Promise<{ id: number }> {
    const virada = dto.tipo === "VIRADA";
    const b = await this.prisma.$transaction(async (tx) => {
      const criado = await tx.bolao.create({
        data: {
          nome: dto.nome,
          tipo: dto.tipo,
          convite: novoConvite(),
          concurso: dto.concurso ?? null,
          dataSorteio: virada ? VIRADA_2026.dataSorteio : null,
          estimativaPremio: virada ? BigInt(VIRADA_2026.estimativa) : null,
        },
      });
      await registrarEvento(tx, criado.id, "bolao_criado", `Bolão criado (${virada ? "Mega da Virada" : "concurso normal"}).`);
      return criado;
    });
    return { id: b.id };
  }

  async resumo(id: number): Promise<ResumoAdmin> {
    const b = await carregarBolao(this.prisma, id);
    const r = resumoDe(b);
    return { bolao: bolaoAdminDTO(b), ...r };
  }

  async atualizar(id: number, dto: AtualizarBolaoDto) {
    let pixChave: string | null | undefined = undefined;
    if (dto.pixChave !== undefined) {
      if (dto.pixChave === null || dto.pixChave === "") pixChave = null;
      else {
        const n = normalizarChave(dto.pixChave);
        if (!n) throw invalido("pix_invalido", "Chave Pix não reconhecida. Use e-mail, CPF, CNPJ, telefone (+55...) ou chave aleatória.");
        pixChave = n.chave;
      }
    }
    let dataSorteio: Date | null | undefined = undefined;
    if (dto.dataSorteio !== undefined) {
      dataSorteio = dto.dataSorteio ? new Date(dto.dataSorteio) : null;
      if (dataSorteio && Number.isNaN(dataSorteio.getTime())) throw invalido("data_invalida", "Data do sorteio inválida.");
    }
    await this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, id);
      const antes = await tx.bolao.findUniqueOrThrow({ where: { id } });
      const temJogos = (await tx.jogo.count({ where: { bolaoId: id } })) > 0;
      if (dto.precoSimples !== undefined && dto.precoSimples !== antes.precoSimples && temJogos) {
        // Muda o valor devido de todo mundo: fica registrado.
        await registrarEvento(tx, id, "preco_alterado", `Preço da aposta simples: ${formatBRL(antes.precoSimples)} para ${formatBRL(dto.precoSimples)}.`);
      }
      await tx.bolao.update({
        where: { id },
        data: {
          nome: dto.nome,
          concurso: dto.concurso,
          dataSorteio,
          precoSimples: dto.precoSimples,
          maxDezenasParticipante: dto.maxDezenasParticipante,
          maxParticipantes: dto.maxParticipantes,
          instrucoes: dto.instrucoes,
          pixChave,
          pixNome: dto.pixNome === undefined ? undefined : dto.pixNome || null,
          pixCidade: dto.pixCidade === undefined ? undefined : dto.pixCidade || null,
          estimativaPremio:
            dto.estimativaPremio === undefined ? undefined : dto.estimativaPremio === null ? null : BigInt(dto.estimativaPremio),
        },
      });
    });
  }

  async excluir(id: number, confirmacao: string) {
    const b = await this.prisma.bolao.findUnique({ where: { id } });
    if (!b) throw naoEncontrado("Bolão não encontrado.");
    if (confirmacao.trim() !== b.nome) throw invalido("confirmacao", "Para excluir, digite o nome exato do bolão.");
    await this.prisma.bolao.delete({ where: { id } });
  }

  async definirInscricoes(id: number, abertas: boolean) {
    await this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, id);
      await tx.bolao.update({ where: { id }, data: { inscricoesAbertas: abertas } });
      await registrarEvento(tx, id, abertas ? "inscricoes_abertas" : "inscricoes_encerradas", abertas ? "Inscrições reabertas." : "Inscrições encerradas.");
    });
  }

  async regenerarConvite(id: number) {
    await this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, id);
      await tx.bolao.update({ where: { id }, data: { convite: novoConvite() } });
      await registrarEvento(tx, id, "convite_regenerado", "Novo link de convite gerado; o anterior deixou de funcionar.");
    });
  }

  // ---------- participantes ----------

  async adicionarParticipante(bolaoId: number, dto: ParticipanteDto) {
    return this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, bolaoId);
      const p = await tx.participante.create({ data: { bolaoId, nome: dto.nome, whatsapp: dto.whatsapp ?? "" } });
      await registrarEvento(tx, bolaoId, "participante_adicionado", `${p.nome} adicionado pelo organizador.`, { participanteId: p.id });
      return { id: p.id };
    });
  }

  async atualizarParticipante(bolaoId: number, id: number, dto: ParticipanteDto) {
    const r = await this.prisma.participante.updateMany({
      where: { id, bolaoId },
      data: { nome: dto.nome, whatsapp: dto.whatsapp ?? "" },
    });
    if (r.count === 0) throw naoEncontrado("Participante não encontrado.");
  }

  async removerParticipante(bolaoId: number, id: number) {
    await this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, bolaoId);
      const p = await tx.participante.findFirst({ where: { id, bolaoId } });
      if (!p) throw naoEncontrado("Participante não encontrado.");
      const registrados = await tx.jogo.count({ where: { participanteId: id, registrado: true } });
      if (registrados > 0) {
        throw conflito("jogos_registrados", "Este participante tem jogos já registrados na Caixa. Desmarque o registro antes de remover.");
      }
      await tx.participante.delete({ where: { id } });
      await registrarEvento(tx, bolaoId, "participante_removido", `${p.nome} removido (pago: ${formatBRL(p.valorPago)}).`, {
        participanteId: id,
        valorPago: p.valorPago,
      });
    });
  }

  async definirPagamento(bolaoId: number, id: number, dto: PagamentoDto) {
    await this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, bolaoId);
      const b = await carregarBolao(tx, bolaoId);
      const p = b.participantes.find((x) => x.id === id);
      if (!p) throw naoEncontrado("Participante não encontrado.");
      if (b.resultadoDezenas.length === 6 && !dto.confirmarComResultado) {
        throw conflito("tem_resultado", "O resultado já foi registrado. Mudar pagamento agora altera o rateio; confirme para continuar.");
      }
      const devido = resumoDe(b).participantes.find((x) => x.id === id)!.devido;
      const valor = dto.valor ?? devido;
      if (valor === p.valorPago) return;
      await tx.participante.update({ where: { id }, data: { valorPago: valor, pagoEm: valor > 0 ? new Date() : null } });
      await registrarEvento(tx, bolaoId, "pagamento", `Pagamento de ${p.nome}: ${formatBRL(p.valorPago)} para ${formatBRL(valor)}.`, {
        participanteId: id,
        antes: p.valorPago,
        depois: valor,
        devido,
        comResultado: b.resultadoDezenas.length === 6,
      });
    });
  }

  // ---------- jogos ----------

  async adicionarJogos(bolaoId: number, dto: JogosDto) {
    const validos: number[][] = [];
    for (let i = 0; i < dto.jogos.length; i++) {
      const r = validarDezenas(dto.jogos[i]);
      if (!r.ok) throw invalido("jogo_invalido", `Jogo ${i + 1}: ${r.erro}`);
      validos.push(r.dezenas);
    }
    return this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, bolaoId);
      const p = await tx.participante.findFirst({ where: { id: dto.participanteId, bolaoId } });
      if (!p) throw naoEncontrado("Participante não encontrado.");
      const total = await tx.jogo.count({ where: { bolaoId } });
      if (total + validos.length > MAX_JOGOS_POR_BOLAO) throw conflito("limite_jogos", "Limite de jogos do bolão atingido.");
      await tx.jogo.createMany({
        data: validos.map((dezenas) => ({ bolaoId, participanteId: p.id, dezenas, surpresinha: !!dto.surpresinha })),
      });
      await registrarEvento(tx, bolaoId, "jogos_adicionados", `${validos.length} jogo(s) para ${p.nome} (pelo organizador).`, {
        participanteId: p.id,
        jogos: validos,
      });
      return { adicionados: validos.length };
    });
  }

  async removerJogo(bolaoId: number, id: number) {
    await this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, bolaoId);
      const j = await tx.jogo.findFirst({ where: { id, bolaoId }, include: { participante: true } });
      if (!j) throw naoEncontrado("Jogo não encontrado.");
      if (j.registrado) throw conflito("jogo_registrado", "Jogo já registrado na Caixa. Desmarque o registro antes de remover.");
      await tx.jogo.delete({ where: { id } });
      await registrarEvento(tx, bolaoId, "jogo_removido", `Jogo ${j.dezenas.map(formatDezena).join(" ")} de ${j.participante.nome} removido.`, {
        jogoId: id,
        dezenas: j.dezenas,
      });
    });
  }

  async registrarJogo(bolaoId: number, id: number, dto: RegistroJogoDto) {
    await this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, bolaoId);
      const j = await tx.jogo.findFirst({ where: { id, bolaoId } });
      if (!j) throw naoEncontrado("Jogo não encontrado.");
      const b = await tx.bolao.findUniqueOrThrow({ where: { id: bolaoId } });
      if (b.resultadoDezenas.length === 6) {
        throw conflito("tem_resultado", "O resultado já foi registrado; não dá para mudar o registro dos jogos.");
      }
      await tx.jogo.update({
        where: { id },
        data: { registrado: dto.registrado, comprovante: dto.comprovante === undefined ? undefined : dto.comprovante || null },
      });
      if (j.registrado !== dto.registrado) {
        await registrarEvento(
          tx,
          bolaoId,
          dto.registrado ? "jogo_registrado" : "jogo_desregistrado",
          `Jogo ${j.dezenas.map(formatDezena).join(" ")} ${dto.registrado ? "registrado" : "desmarcado"} na Caixa.`,
          { jogoId: id },
        );
      }
    });
  }

  // ---------- resultado ----------

  private async gravarResultado(
    bolaoId: number,
    dezenas: number[],
    premios: { sena: number; quina: number; quadra: number },
    fonte: "caixa" | "manual",
    concurso?: number,
  ) {
    const r = validarDezenas(dezenas, { min: 6, max: 6 });
    if (!r.ok) throw invalido("resultado_invalido", r.erro);
    await this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, bolaoId);
      await tx.bolao.update({
        where: { id: bolaoId },
        data: {
          resultadoDezenas: r.dezenas,
          premioSena: BigInt(premios.sena),
          premioQuina: BigInt(premios.quina),
          premioQuadra: BigInt(premios.quadra),
          resultadoFonte: fonte,
          resultadoEm: new Date(),
          inscricoesAbertas: false,
          ...(concurso ? { concurso } : {}),
        },
      });
      await registrarEvento(
        tx,
        bolaoId,
        "resultado",
        `Resultado (${fonte === "caixa" ? "Caixa" : "manual"}): ${r.dezenas.map(formatDezena).join(" ")}. Inscrições encerradas.`,
        { dezenas: r.dezenas, premios, fonte },
      );
    });
  }

  async resultadoManual(bolaoId: number, dto: ResultadoManualDto) {
    await this.gravarResultado(bolaoId, dto.dezenas, dto.premios, "manual");
  }

  async resultadoCaixa(bolaoId: number, concursoPedido?: number) {
    const b = await this.prisma.bolao.findUnique({ where: { id: bolaoId } });
    if (!b) throw naoEncontrado("Bolão não encontrado.");
    const numero = concursoPedido ?? b.concurso ?? undefined;
    if (!numero) throw invalido("sem_concurso", "Informe o número do concurso do bolão antes de buscar na Caixa.");
    const c = await this.caixa.concurso(numero);
    if (!c) throw conflito("sem_resultado", "A Caixa ainda não publicou o resultado desse concurso.");
    await this.gravarResultado(bolaoId, c.dezenas, c.premios, "caixa", c.numero);
    return c;
  }

  async limparResultado(bolaoId: number) {
    await this.prisma.$transaction(async (tx) => {
      await travarBolao(tx, bolaoId);
      await tx.bolao.update({
        where: { id: bolaoId },
        data: { resultadoDezenas: [], premioSena: null, premioQuina: null, premioQuadra: null, resultadoFonte: null, resultadoEm: null },
      });
      await registrarEvento(tx, bolaoId, "resultado_removido", "Resultado removido.");
    });
  }

  // ---------- histórico e exportação ----------

  async eventos(bolaoId: number): Promise<EventoDTO[]> {
    const es = await this.prisma.evento.findMany({ where: { bolaoId }, orderBy: { id: "desc" }, take: 300 });
    return es.map((e) => ({ id: e.id, tipo: e.tipo, descricao: e.descricao, criadoEm: e.criadoEm.toISOString() }));
  }

  async exportarCsv(bolaoId: number): Promise<{ nome: string; csv: string }> {
    const b = await carregarBolao(this.prisma, bolaoId);
    const r = resumoDe(b);
    const nomeDe = new Map(r.participantes.map((p) => [p.id, p]));
    const linhas = [
      ["jogo", "participante", "whatsapp", "dezenas", "qtd_dezenas", "preco_reais", "registrado", "comprovante", "situacao_participante"],
      ...r.jogos.map((j, i) => {
        const p = nomeDe.get(j.participanteId)!;
        return [
          i + 1,
          p.nome,
          p.whatsapp,
          j.dezenas.map(formatDezena).join(" "),
          j.dezenas.length,
          (j.preco / 100).toFixed(2).replace(".", ","),
          j.registrado ? "sim" : "nao",
          j.comprovante ?? "",
          p.situacao,
        ];
      }),
    ];
    // BOM para o Excel abrir com acento; ; como separador (padrão pt-BR).
    const csv = "﻿" + linhas.map((l) => l.map(celulaCsv).join(";")).join("\r\n") + "\r\n";
    const nome = `bolao-${b.id}-jogos.csv`;
    return { nome, csv };
  }
}
