import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { naoAutenticado, proibido } from "../common/erros";
import { COOKIE_SESSAO } from "../common/cookies";
import { AuthService } from "./auth.service";

export type RequestComAdmin = Request & { adminId?: number; papel?: "ADMIN" | "ORGANIZADOR" };

export const lerCookie = (req: Request, nome: string): string | undefined => {
  const v = (req.cookies as Record<string, unknown> | undefined)?.[nome];
  return typeof v === "string" ? v : undefined;
};

/** Exige sessão válida do organizador. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequestComAdmin>();
    const s = await this.auth.validar(lerCookie(req, COOKIE_SESSAO));
    if (!s) throw naoAutenticado();
    req.adminId = s.id;
    req.papel = s.papel;
    return true;
  }
}

/** Exige o ADMIN (gestão de contas de organizador). Usar depois do AdminGuard. */
@Injectable()
export class PapelAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<RequestComAdmin>();
    if (req.papel !== "ADMIN") throw proibido("Só o administrador gerencia organizadores.");
    return true;
  }
}
