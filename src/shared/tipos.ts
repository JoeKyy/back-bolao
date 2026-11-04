// Formato das respostas da API. ESTE ARQUIVO É IDÊNTICO nos dois repositórios:
//   back-bolao/src/shared/tipos.ts  e  bolao-web/packages/shared/src/tipos.ts
// (ver o aviso em regras.ts sobre o contrato).

import type { Conferencia, Faixa, PremiosPorFaixa } from "./regras";

export type TipoBolao = "VIRADA" | "NORMAL";
export type Situacao = "quitado" | "parcial" | "pendente";
export type FonteResultado = "caixa" | "manual";

/** Toda resposta de erro da API. `mensagem` é sempre texto fixo do servidor, nunca eco da entrada. */
export interface ErroApi {
  codigo: string;
  mensagem: string;
}

export interface BolaoNaLista {
  id: number;
  nome: string;
  tipo: TipoBolao;
  concurso: number | null;
  inscricoesAbertas: boolean;
  participantes: number;
  quitados: number;
  arrecadado: number;
  jogos: number;
  temResultado: boolean;
}

export interface ResultadoDTO {
  dezenas: number[];
  premios: PremiosPorFaixa;
  fonte: FonteResultado;
  registradoEm: string;
}

export interface BolaoDTO {
  id: number;
  nome: string;
  tipo: TipoBolao;
  concurso: number | null;
  dataSorteio: string | null;
  precoSimples: number;
  maxDezenasParticipante: number;
  maxParticipantes: number;
  inscricoesAbertas: boolean;
  instrucoes: string;
  estimativaPremio: number | null;
  resultado: ResultadoDTO | null;
}

export interface PixConfig {
  chave: string;
  nome: string;
  cidade: string;
}

export interface BolaoAdminDTO extends BolaoDTO {
  convite: string;
  pix: PixConfig | null;
}

export interface JogoDTO {
  id: number;
  participanteId: number;
  dezenas: number[];
  preco: number;
  surpresinha: boolean;
  registrado: boolean;
  conferencia: Conferencia | null;
}

export interface JogoAdminDTO extends JogoDTO {
  comprovante: string | null;
}

export interface ParticipanteDTO {
  id: number;
  nome: string;
  devido: number;
  pago: number;
  situacao: Situacao;
  /** Parte do prêmio (centavos), só quando há resultado. */
  parte: number | null;
}

export interface ParticipanteAdminDTO extends ParticipanteDTO {
  whatsapp: string;
  criadoEm: string;
}

export interface Totais {
  devido: number;
  arrecadado: number;
  /** Soma dos pesos (valor pago que conta para o rateio). */
  pesoTotal: number;
  premioBolao: number | null;
  melhorFaixa: Faixa | null;
  jogos: number;
  jogosRegistrados: number;
}

export interface Chance {
  apostas: number;
  umEm: number | null;
}

export interface ResumoAdmin {
  bolao: BolaoAdminDTO;
  participantes: ParticipanteAdminDTO[];
  jogos: JogoAdminDTO[];
  totais: Totais;
  chance: Chance;
}

export interface ConvitePublico {
  nome: string;
  tipo: TipoBolao;
  concurso: number | null;
  dataSorteio: string | null;
  precoSimples: number;
  inscricoesAbertas: boolean;
  jaInscrito: boolean;
}

export interface PixCobranca {
  valor: number;
  copiaECola: string;
  identificador: string;
}

export interface PainelParticipante {
  bolao: BolaoDTO;
  eu: ParticipanteDTO | null;
  /** true quando quem vê é o organizador (sem participante próprio). */
  visaoOrganizador: boolean;
  pix: PixCobranca | null;
  meusJogos: JogoDTO[];
  /** Todos os jogos do bolão, para transparência (sem dono). */
  jogos: JogoDTO[];
  participantes: ParticipanteDTO[];
  totais: Totais;
  chance: Chance;
}

export interface ConcursoCaixa {
  numero: number;
  data: string;
  dezenas: number[];
  premios: PremiosPorFaixa;
  ganhadores: { sena: number; quina: number; quadra: number };
  acumulou: boolean;
  proximoConcurso: number | null;
  dataProximo: string | null;
  estimativaProximo: number | null;
  acumuladoVirada: number | null;
}

export interface EventoDTO {
  id: number;
  tipo: string;
  descricao: string;
  criadoEm: string;
}
