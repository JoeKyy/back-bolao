// Consolidação pura do bolão (sem banco). Toda conta de dinheiro passa por aqui.
//
// Regras:
// - Cada jogo custa precoJogo(k, precoSimples). O participante deve a soma dos jogos dele.
// - O organizador confirma quanto recebeu (valorPago). Peso no rateio = min(pago, devido).
// - Só jogo marcado como REGISTRADO na Caixa é conferido e gera prêmio.
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

  const pesos = parts.map((p) => ({ id: p.id, peso: Math.min(p.valorPago, devidoPor.get(p.id) ?? 0) }));
  const pesoTotal = pesos.reduce((s, p) => s + p.peso, 0);

  const confs = jogos.flatMap((j) => (j.conferencia ? [j.conferencia] : []));
  const premioBolao = temResultado ? premioDasConferencias(confs, b.premios!) : null;
  const rateio = premioBolao !== null ? ratear(premioBolao, pesos) : null;

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
  const pagantes = new Set(pesos.filter((p) => p.peso > 0).map((p) => p.id));
  const chance = chanceSena(jogos.filter((j) => pagantes.has(j.participanteId)).map((j) => j.dezenas));

  const totais: Totais = {
    devido: participantes.reduce((s, p) => s + p.devido, 0),
    arrecadado: parts.reduce((s, p) => s + p.valorPago, 0),
    pesoTotal,
    premioBolao,
    melhorFaixa: temResultado ? melhorFaixa(confs) : null,
    jogos: jogos.length,
    jogosRegistrados: jogos.filter((j) => j.registrado).length,
  };

  return { participantes, jogos, totais, chance };
}
