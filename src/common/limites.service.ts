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

@Global()
@Module({ providers: [LimitesService], exports: [LimitesService] })
export class LimitesModule {}
