import { Injectable, Logger } from "@nestjs/common";
import { config } from "../common/config";
import { ErroNegocio } from "../common/erros";
import { HttpStatus } from "@nestjs/common";
import type { ConcursoCaixa } from "../shared/tipos";

const TEMPO_LIMITE_MS = 6000;
const CACHE_MS = 10 * 60 * 1000;

const TAMANHO_MAXIMO = 200_000;
/** R$ 10 bilhões: acima disso o valor é hostil ou erro (SEC-09). */
const TETO_CENTAVOS = 1_000_000_000_000;

const reaisParaCentavos = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v * 100 <= TETO_CENTAVOS ? Math.round(v * 100) : null;

/** Lê o corpo com teto de tamanho, abortando no meio se passar (SEC-09). */
export async function lerComLimite(r: Response, max = TAMANHO_MAXIMO): Promise<string> {
  const declarado = Number(r.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > max) throw new Error("resposta grande demais");
  if (!r.body) return "";
  const leitor = r.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await leitor.cancel();
      throw new Error("resposta grande demais");
    }
    partes.push(value);
  }
  return Buffer.concat(partes).toString("utf8");
}

const inteiro = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);

/**
 * Converte o JSON da API pública da Caixa no nosso formato, conferindo cada campo.
 * A API não é documentada: qualquer coisa fora do esperado vira null (não confiamos no formato).
 */
export function lerConcursoCaixa(j: unknown): ConcursoCaixa | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const numero = inteiro(o.numero);
  const dezenas = Array.isArray(o.listaDezenas) ? o.listaDezenas.map((d) => Number(d)) : [];
  if (!numero || dezenas.length !== 6 || dezenas.some((d) => !Number.isInteger(d) || d < 1 || d > 60)) return null;

  const faixas = Array.isArray(o.listaRateioPremio) ? (o.listaRateioPremio as Record<string, unknown>[]) : [];
  const faixa = (n: number) => faixas.find((f) => f && f.faixa === n);
  const valor = (n: number) => reaisParaCentavos(faixa(n)?.valorPremio) ?? 0;
  // Prêmio fora do teto em qualquer faixa: não confiamos no resultado inteiro.
  for (const n of [1, 2, 3]) {
    const v = faixa(n)?.valorPremio;
    if (v !== undefined && v !== null && typeof v === "number" && reaisParaCentavos(v) === null) return null;
  }
  const ganh = (n: number) => {
    const g = faixa(n)?.numeroDeGanhadores;
    return typeof g === "number" && Number.isInteger(g) && g >= 0 ? g : 0;
  };

  return {
    numero,
    data: typeof o.dataApuracao === "string" ? o.dataApuracao.slice(0, 10) : "",
    dezenas: [...dezenas].sort((a, b) => a - b),
    premios: { sena: valor(1), quina: valor(2), quadra: valor(3) },
    ganhadores: { sena: ganh(1), quina: ganh(2), quadra: ganh(3) },
    acumulou: o.acumulado === true,
    proximoConcurso: inteiro(o.numeroConcursoProximo),
    dataProximo: typeof o.dataProximoConcurso === "string" ? o.dataProximoConcurso.slice(0, 10) : null,
    estimativaProximo: reaisParaCentavos(o.valorEstimadoProximoConcurso),
    acumuladoVirada: reaisParaCentavos(o.valorAcumuladoConcursoEspecial),
  };
}

@Injectable()
export class CaixaService {
  private readonly log = new Logger("Caixa");
  private readonly cache = new Map<string, { ate: number; em: number; valor: ConcursoCaixa | null }>();

  /** Último concurso (sem número) ou um concurso específico. null quando ainda não saiu. */
  /**
   * `fresco`: busca explícita do organizador. Ignora o cache de 10 min, para que "tentar de novo"
   * depois de um resultado incompleto (RVAL-06) enxergue o rateio publicado, mas respeita um
   * intervalo mínimo de 30 s por concurso para não martelar a API da Caixa.
   */
  async concurso(numero?: number, fresco = false): Promise<ConcursoCaixa | null> {
    const base = config().caixaApiUrl;
    if (!base) throw new ErroNegocio(HttpStatus.SERVICE_UNAVAILABLE, "caixa_desligada", "Consulta à Caixa desligada.");
    const chave = numero ? String(numero) : "ultimo";
    const c = this.cache.get(chave);
    if (c && c.ate > Date.now() && (!fresco || Date.now() - c.em < 30_000)) return c.valor;

    const url = numero ? `${base}/${numero}` : base;
    let valor: ConcursoCaixa | null;
    try {
      const r = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (bolao)" },
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
        redirect: "error",
      });
      if (r.status === 404) {
        valor = null;
      } else if (!r.ok) {
        throw new Error(`status ${r.status}`);
      } else {
        valor = lerConcursoCaixa(JSON.parse(await lerComLimite(r)));
      }
    } catch (e) {
      this.log.warn(`Falha ao consultar a Caixa (${chave}): ${e instanceof Error ? e.message : String(e)}`);
      throw new ErroNegocio(
        HttpStatus.BAD_GATEWAY,
        "caixa_indisponivel",
        "Não foi possível consultar a Caixa agora. Tente mais tarde ou informe o resultado à mão.",
      );
    }
    this.cache.set(chave, { ate: Date.now() + CACHE_MS, em: Date.now(), valor });
    return valor;
  }
}
