// Consolidação pura do bolão (sem banco). Toda conta de dinheiro passa por aqui.
//
// Regras:
// - Cada jogo custa precoJogo(k, precoSimples). O participante deve a soma dos jogos dele.
// - O organizador confirma quanto recebeu (valorPago).
// - Só jogo marcado como REGISTRADO na Caixa é conferido e gera prêmio.
// - Peso no rateio = min(pago, valor dos jogos REGISTRADOS do participante) (SEC-01): quem não
//   tem jogo registrado não entra no rateio, mesmo que tenha pago depois do sorteio.
// - Prêmio do bolão = soma, nos jogos registrados, de senas/quinas/quadras × valor da faixa.
// - Rateio do prêmio proporcional ao peso (maior resto, sem perder centavo).

import {
  chanceSena,
  conferir,
  melhorFaixa,
  precoJogo,
  premioDasConferencias,
  ratear,
  type Conferencia,
  type PremiosPorFaixa,
} from "../shared/regras";
import type { Chance, JogoAdminDTO, ParticipanteAdminDTO, Situacao, Totais } from "../shared/tipos";

export interface BolaoBase {
  precoSimples: number;
  resultadoDezenas: number[];
  premios: PremiosPorFaixa | null;
}

export interface ParticipanteBase {
  id: number;
  nome: string;
  whatsapp: string;
  valorPago: number;
  criadoEm: Date;
}

export interface JogoBase {
  id: number;
  participanteId: number;
  dezenas: number[];
  surpresinha: boolean;
  registrado: boolean;
  comprovante: string | null;
}

export interface Resumo {
  participantes: ParticipanteAdminDTO[];
  jogos: JogoAdminDTO[];
  totais: Totais;
  chance: Chance;
}

export function situacaoDe(devido: number, pago: number): Situacao {
  if (devido > 0 && pago >= devido) return "quitado";
  if (pago > 0) return "parcial";
  return "pendente";
}

export function montarResumo(b: BolaoBase, parts: ParticipanteBase[], jogosBase: JogoBase[]): Resumo {
  const temResultado = b.resultadoDezenas.length === 6 && !!b.premios;

  const jogos: JogoAdminDTO[] = jogosBase.map((j) => {
    const conferencia: Conferencia | null = temResultado && j.registrado ? conferir(j.dezenas, b.resultadoDezenas) : null;
    return {
      id: j.id,
      participanteId: j.participanteId,
      dezenas: j.dezenas,
      preco: precoJogo(j.dezenas.length, b.precoSimples),
      surpresinha: j.surpresinha,
      registrado: j.registrado,
      comprovante: j.comprovante,
      conferencia,
    };
  });

  const devidoPor = new Map<number, number>();
  for (const j of jogos) devidoPor.set(j.participanteId, (devidoPor.get(j.participanteId) ?? 0) + j.preco);

  const registradoPor = new Map<number, number>();
  for (const j of jogos) if (j.registrado) registradoPor.set(j.participanteId, (registradoPor.get(j.participanteId) ?? 0) + j.preco);

  const pesos = parts.map((p) => ({ id: p.id, peso: Math.min(p.valorPago, registradoPor.get(p.id) ?? 0) }));
  const pesoTotal = pesos.reduce((s, p) => s + p.peso, 0);
  const pesoPrevisto = parts.reduce((s, p) => s + Math.min(p.valorPago, devidoPor.get(p.id) ?? 0), 0);

  const confs = jogos.flatMap((j) => (j.conferencia ? [j.conferencia] : []));
  const premioGrande = temResultado ? premioDasConferencias(confs, b.premios!) : null;
  if (premioGrande !== null && premioGrande > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Prêmio do bolão fora da faixa segura; confira os valores por faixa.");
  }
  const premioBolao = premioGrande === null ? null : Number(premioGrande);
  const rateio = premioGrande !== null ? ratear(premioGrande, pesos) : null;

  const participantes: ParticipanteAdminDTO[] = parts.map((p) => {
    const devido = devidoPor.get(p.id) ?? 0;
    return {
      id: p.id,
      nome: p.nome,
      whatsapp: p.whatsapp,
      devido,
      pago: p.valorPago,
      situacao: situacaoDe(devido, p.valorPago),
      parte: rateio ? rateio.get(p.id) ?? 0 : null,
      criadoEm: p.criadoEm.toISOString(),
    };
  });

  // Chance: jogos de quem já pagou (é o que de fato vai ser registrado).
  const pagantes = new Set(parts.filter((p) => p.valorPago > 0).map((p) => p.id));
  const chance = chanceSena(jogos.filter((j) => pagantes.has(j.participanteId)).map((j) => j.dezenas));

  const totais: Totais = {
    devido: participantes.reduce((s, p) => s + p.devido, 0),
    arrecadado: parts.reduce((s, p) => s + p.valorPago, 0),
    pesoTotal,
    pesoPrevisto,
    premioBolao,
    melhorFaixa: temResultado ? melhorFaixa(confs) : null,
    jogos: jogos.length,
    jogosRegistrados: jogos.filter((j) => j.registrado).length,
  };

  return { participantes, jogos, totais, chance };
}
