import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { RequestComAdmin } from "../auth/auth.guard";
import { naoEncontrado } from "../common/erros";
import { IdPipe } from "../common/id.pipe";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Isolamento entre organizadores: em toda rota com `:id`, o bolão precisa ser do organizador
 * logado (o tesoureiro). De outro organizador responde 404, igual a bolão inexistente, para não
 * revelar que existe. Usar depois do AdminGuard.
 *
 * Checar antes de agir é seguro porque o dono de um bolão nunca muda (não há transferência).
 */
@Injectable()
export class DonoDoBolaoGuard implements CanActivate {
  private readonly id = new IdPipe();
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequestComAdmin>();
    const bruto = (req.params as Record<string, string | undefined>).id;
    if (bruto === undefined) return true;
    const id = this.id.transform(bruto);
    const b = await this.prisma.bolao.findFirst({ where: { id, donoId: req.adminId }, select: { id: true } });
    if (!b) throw naoEncontrado("Bolão não encontrado.");
    return true;
  }
}
