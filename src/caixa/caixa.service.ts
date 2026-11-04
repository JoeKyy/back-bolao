import { Injectable, Logger } from "@nestjs/common";
import { config } from "../common/config";
import { ErroNegocio } from "../common/erros";
import { HttpStatus } from "@nestjs/common";
import type { ConcursoCaixa } from "../shared/tipos";

const TEMPO_LIMITE_MS = 6000;
const CACHE_MS = 10 * 60 * 1000;

const reaisParaCentavos = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;

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
  private readonly cache = new Map<string, { ate: number; valor: ConcursoCaixa | null }>();

  /** Último concurso (sem número) ou um concurso específico. null quando ainda não saiu. */
  async concurso(numero?: number): Promise<ConcursoCaixa | null> {
    const base = config().caixaApiUrl;
    if (!base) throw new ErroNegocio(HttpStatus.SERVICE_UNAVAILABLE, "caixa_desligada", "Consulta à Caixa desligada.");
    const chave = numero ? String(numero) : "ultimo";
    const c = this.cache.get(chave);
    if (c && c.ate > Date.now()) return c.valor;

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
        const texto = await r.text();
        if (texto.length > 200_000) throw new Error("resposta grande demais");
        valor = lerConcursoCaixa(JSON.parse(texto));
      }
    } catch (e) {
      this.log.warn(`Falha ao consultar a Caixa (${chave}): ${e instanceof Error ? e.message : String(e)}`);
      throw new ErroNegocio(
        HttpStatus.BAD_GATEWAY,
        "caixa_indisponivel",
        "Não foi possível consultar a Caixa agora. Tente mais tarde ou informe o resultado à mão.",
      );
    }
    this.cache.set(chave, { ate: Date.now() + CACHE_MS, valor });
    return valor;
  }
}
