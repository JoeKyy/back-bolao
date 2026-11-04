// Regras puras do bolão. ESTE ARQUIVO É IDÊNTICO nos dois repositórios:
//   back-bolao/src/shared/regras.ts  e  bolao-web/packages/shared/src/regras.ts
// O teste `contrato` de cada lado compara o sha256 dele com `contrato.json`; mudou aqui,
// copie para o outro lado e rode `pnpm contrato:gerar` nos dois.
//
// Dinheiro sempre em centavos (inteiro). Contas que multiplicam prêmio por peso usam BigInt:
// R$ 1 bilhão são 1e11 centavos, e 1e11 × um peso de 1e6 já passa de Number.MAX_SAFE_INTEGER.

export const MAX_NUMERO = 60;
export const MIN_DEZENAS_JOGO = 6;
export const MAX_DEZENAS_JOGO = 20;
/** C(60, 6): total de combinações possíveis da Mega-Sena. */
export const TOTAL_COMBINACOES = 50_063_860;

export type ParseResult = { ok: true; dezenas: number[] } | { ok: false; erro: string };

/** Valida uma lista de dezenas já em número. Devolve ordenada. */
export function validarDezenas(nums: number[], opts: { min?: number; max?: number } = {}): ParseResult {
  const min = opts.min ?? MIN_DEZENAS_JOGO;
  const max = opts.max ?? MAX_DEZENAS_JOGO;
  if (nums.length === 0) return { ok: false, erro: "Informe as dezenas." };
  if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > MAX_NUMERO)) {
    return { ok: false, erro: `As dezenas devem estar entre 1 e ${MAX_NUMERO}.` };
  }
  if (new Set(nums).size !== nums.length) return { ok: false, erro: "Há dezenas repetidas." };
  if (nums.length < min || nums.length > max) {
    return {
      ok: false,
      erro:
        min === max
          ? `Informe exatamente ${min} dezenas.`
          : `Informe de ${min} a ${max} dezenas (você informou ${nums.length}).`,
    };
  }
  return { ok: true, dezenas: [...nums].sort((a, b) => a - b) };
}

/** Lê dezenas de texto livre ("1 2 3", "01-02-03", "1, 2, 3") e valida. */
export function parseDezenas(input: string, opts: { min?: number; max?: number } = {}): ParseResult {
  const nums = input
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number);
  return validarDezenas(nums, opts);
}

export function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** Quantas apostas simples um jogo de k dezenas representa. */
export const apostasSimples = (k: number) => comb(k, 6);

/** Preço de um jogo de k dezenas, dado o preço da aposta simples (centavos). */
export const precoJogo = (k: number, precoSimples: number) => apostasSimples(k) * precoSimples;

export type Faixa = "sena" | "quina" | "quadra";

export interface Conferencia {
  acertadas: number[];
  acertos: number;
  senas: number;
  quinas: number;
  quadras: number;
  faixa: Faixa | null;
}

/**
 * Confere um jogo (6 a 20 dezenas) contra as 6 sorteadas. Um jogo de k dezenas equivale a
 * C(k,6) apostas simples; conta quantas delas fazem sena, quina e quadra.
 */
export function conferir(jogo: number[], sorteadas: number[]): Conferencia {
  const sorteio = new Set(sorteadas);
  const acertadas = jogo.filter((n) => sorteio.has(n));
  const h = acertadas.length;
  const k = jogo.length;
  const combos = (m: number) => comb(h, m) * comb(k - h, 6 - m);
  const senas = combos(6);
  const quinas = combos(5);
  const quadras = combos(4);
  const faixa: Faixa | null = senas ? "sena" : quinas ? "quina" : quadras ? "quadra" : null;
  return { acertadas, acertos: h, senas, quinas, quadras, faixa };
}

const ORDEM_FAIXA: Record<Faixa, number> = { sena: 3, quina: 2, quadra: 1 };

export function melhorFaixa(conferencias: Conferencia[]): Faixa | null {
  let melhor: Faixa | null = null;
  for (const c of conferencias) {
    if (c.faixa && (!melhor || ORDEM_FAIXA[c.faixa] > ORDEM_FAIXA[melhor])) melhor = c.faixa;
  }
  return melhor;
}

/** Valor por ganhador de cada faixa (centavos), como a Caixa divulga. */
export interface PremiosPorFaixa {
  sena: number;
  quina: number;
  quadra: number;
}

/** Teto de valor por faixa (centavos): R$ 10 bilhões. Acima disso é erro de digitação ou dado hostil. */
export const MAX_PREMIO_FAIXA = 1_000_000_000_000;

/** Prêmio total (centavos) de um conjunto de conferências, em BigInt (não arredonda). */
export function premioDasConferencias(confs: Conferencia[], p: PremiosPorFaixa): bigint {
  let total = 0n;
  for (const c of confs) {
    total += BigInt(c.senas) * BigInt(p.sena) + BigInt(c.quinas) * BigInt(p.quina) + BigInt(c.quadras) * BigInt(p.quadra);
  }
  return total;
}

export interface ItemRateio {
  id: number;
  /** Peso do participante: o valor (centavos) com que ele entrou e que está pago. */
  peso: number;
}

/**
 * Divide o prêmio (centavos) proporcionalmente ao peso, sem perder centavos: método do maior
 * resto, desempate pelo menor id. Em BigInt para não estourar com prêmios de bilhão.
 */
export function ratear(premio: number | bigint, itens: ItemRateio[]): Map<number, number> {
  const resultado = new Map<number, number>();
  const total = itens.reduce((s, i) => s + BigInt(Math.max(0, i.peso)), 0n);
  const P = typeof premio === "bigint" ? (premio > 0n ? premio : 0n) : BigInt(Math.max(0, Math.trunc(premio)));
  if (total <= 0n || P <= 0n) {
    for (const i of itens) resultado.set(i.id, 0);
    return resultado;
  }
  const partes = itens.map((i) => {
    const bruto = P * BigInt(Math.max(0, i.peso));
    return { id: i.id, base: bruto / total, resto: bruto % total };
  });
  let sobra = P - partes.reduce((s, p) => s + p.base, 0n);
  const porResto = [...partes].sort((a, b) => (b.resto > a.resto ? 1 : b.resto < a.resto ? -1 : a.id - b.id));
  for (const p of porResto) {
    if (sobra <= 0n) break;
    p.base += 1n;
    sobra -= 1n;
  }
  for (const p of partes) resultado.set(p.id, Number(p.base));
  return resultado;
}

/** Parte (centavos) de quem tem `peso` num total `pesoTotal`, para um prêmio hipotético. */
export function parteHipotetica(premio: number, peso: number, pesoTotal: number): number {
  if (pesoTotal <= 0 || peso <= 0 || premio <= 0) return 0;
  return Number((BigInt(Math.trunc(premio)) * BigInt(peso)) / BigInt(pesoTotal));
}

/**
 * Chance de o conjunto de jogos fazer a sena: apostas simples cobertas / C(60,6).
 * Limite superior (jogos repetidos ou sobrepostos contam duas vezes). Devolve "1 em N".
 */
export function chanceSena(jogos: number[][]): { apostas: number; umEm: number | null } {
  const apostas = jogos.reduce((s, j) => s + apostasSimples(j.length), 0);
  if (apostas <= 0) return { apostas: 0, umEm: null };
  return { apostas, umEm: Math.max(1, Math.round(TOTAL_COMBINACOES / apostas)) };
}

/**
 * Surpresinha: k dezenas distintas de 1 a 60. `aleatorio(n)` devolve inteiro uniforme em [0, n)
 * (no servidor, crypto.randomInt; no navegador, crypto.getRandomValues com rejeição).
 */
export function surpresinha(k: number, aleatorio: (n: number) => number): number[] {
  if (!Number.isInteger(k) || k < MIN_DEZENAS_JOGO || k > MAX_DEZENAS_JOGO) {
    throw new Error(`Quantidade de dezenas inválida: ${k}`);
  }
  const pool = Array.from({ length: MAX_NUMERO }, (_, i) => i + 1);
  for (let i = 0; i < k; i++) {
    const j = i + aleatorio(MAX_NUMERO - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, k).sort((a, b) => a - b);
}

/** "1.234,56" | "1234,56" | "12.5" | "R$ 10" -> centavos; null se inválido. */
export function parseReais(input: string): number | null {
  let s = input.replace(/[^0-9,.]/g, "");
  if (!s) return null;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (!/^\d+\.\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function formatBRL(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDezena(n: number): string {
  return String(n).padStart(2, "0");
}
