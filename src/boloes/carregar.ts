import type { Bolao, Jogo, Participante } from "@prisma/client";
import { naoEncontrado } from "../common/erros";
import type { Tx } from "../prisma/prisma.service";
import type { BolaoAdminDTO, BolaoDTO } from "../shared/tipos";
import { montarResumo, type Resumo } from "./resumo";

export type BolaoCompleto = Bolao & { participantes: Participante[]; jogos: Jogo[] };

export async function carregarBolao(db: Tx, id: number): Promise<BolaoCompleto> {
  const b = await db.bolao.findUnique({
    where: { id },
    include: { participantes: { orderBy: [{ nome: "asc" }, { id: "asc" }] }, jogos: { orderBy: { id: "asc" } } },
  });
  if (!b) throw naoEncontrado("Bolão não encontrado.");
  return b;
}

const num = (v: bigint | null) => (v === null ? null : Number(v));

export function premiosDe(b: Bolao) {
  return b.resultadoDezenas.length === 6 && b.premioSena !== null && b.premioQuina !== null && b.premioQuadra !== null
    ? { sena: Number(b.premioSena), quina: Number(b.premioQuina), quadra: Number(b.premioQuadra) }
    : null;
}

export function bolaoDTO(b: Bolao): BolaoDTO {
  const premios = premiosDe(b);
  return {
    id: b.id,
    nome: b.nome,
    tipo: b.tipo,
    concurso: b.concurso,
    dataSorteio: b.dataSorteio?.toISOString() ?? null,
    precoSimples: b.precoSimples,
    maxDezenasParticipante: b.maxDezenasParticipante,
    maxParticipantes: b.maxParticipantes,
    inscricoesAbertas: b.inscricoesAbertas,
    instrucoes: b.instrucoes,
    estimativaPremio: num(b.estimativaPremio),
    resultado: premios
      ? {
          dezenas: b.resultadoDezenas,
          premios,
          fonte: b.resultadoFonte ?? "manual",
          registradoEm: (b.resultadoEm ?? b.criadoEm).toISOString(),
        }
      : null,
  };
}

export function bolaoAdminDTO(b: Bolao): BolaoAdminDTO {
  return {
    ...bolaoDTO(b),
    convite: b.convite,
    pix: b.pixChave ? { chave: b.pixChave, nome: b.pixNome ?? "", cidade: b.pixCidade ?? "" } : null,
  };
}

export function resumoDe(b: BolaoCompleto): Resumo {
  return montarResumo(
    { precoSimples: b.precoSimples, resultadoDezenas: b.resultadoDezenas, premios: premiosDe(b) },
    b.participantes,
    b.jogos,
  );
}

/** Trava a linha do bolão até o fim da transação (serializa escritas concorrentes no mesmo bolão). */
export async function travarBolao(tx: Tx, id: number) {
  const r = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "Bolao" WHERE id = ${id} FOR UPDATE`;
  if (r.length === 0) throw naoEncontrado("Bolão não encontrado.");
}

export async function registrarEvento(
  tx: Tx,
  bolaoId: number,
  tipo: string,
  descricao: string,
  dados?: Record<string, unknown>,
) {
  await tx.evento.create({ data: { bolaoId, tipo, descricao, dados: dados as object | undefined } });
}
