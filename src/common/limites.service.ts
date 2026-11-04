import { Global, Injectable, Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Limite de tentativas gravado no Postgres (BOL-01). Diferente do limitador antigo:
 * - a chave usa o IP que o Express resolveu com `trust proxy` (o cabeçalho só vale vindo do
 *   proxy confiável), então trocar `X-Forwarded-For` não cria uma chave nova;
 * - reiniciar o processo não zera a contagem.
 */
@Injectable()
export class LimitesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Conta e registra numa só operação atômica (SEC-05): um advisory lock por chave serializa
   * requisições paralelas, então 40 tentativas simultâneas não veem todas a mesma contagem.
   * Devolve false (e não registra) quando o teto já foi atingido.
   */
  async consumir(chave: string, max: number, janelaMs: number): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${chave}))::text`;
      const n = await tx.tentativa.count({ where: { chave, criadoEm: { gte: new Date(Date.now() - janelaMs) } } });
      if (n >= max) return false;
      await tx.tentativa.create({ data: { chave } });
      return true;
    });
  }

  /** Quantas tentativas a chave teve na janela. */
  async contar(chave: string, janelaMs: number): Promise<number> {
    return this.prisma.tentativa.count({
      where: { chave, criadoEm: { gte: new Date(Date.now() - janelaMs) } },
    });
  }

  async registrar(chave: string): Promise<void> {
    await this.prisma.tentativa.create({ data: { chave } });
  }

  async limpar(chave: string): Promise<void> {
    await this.prisma.tentativa.deleteMany({ where: { chave } });
  }

  /** Apaga o que já saiu de qualquer janela (chamado de vez em quando). */
  async varrer(maisVelhoQueMs = 24 * 60 * 60 * 1000): Promise<void> {
    await this.prisma.tentativa.deleteMany({ where: { criadoEm: { lt: new Date(Date.now() - maisVelhoQueMs) } } });
  }
}

/**
 * Chave de IP para limites. IPv6 é agrupado por /64 (SEC-06): um único cliente costuma ter um
 * /64 inteiro e trocaria de endereço a cada tentativa. IPv4 mapeado em IPv6 vira IPv4.
 */
export function agruparIp(ip: string): string {
  const v = ip.trim().toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");
  if (!v.includes(":")) return v;
  const [esq, dir = ""] = v.split("::");
  const a = esq ? esq.split(":") : [];
  const b = dir ? dir.split(":") : [];
  const meio = v.includes("::") ? Array(Math.max(0, 8 - a.length - b.length)).fill("0") : [];
  const partes = [...a, ...meio, ...b].map((x) => x.replace(/^0+(?=.)/, ""));
  return `${partes.slice(0, 4).join(":")}::/64`;
}

@Global()
@Module({ providers: [LimitesService], exports: [LimitesService] })
export class LimitesModule {}
