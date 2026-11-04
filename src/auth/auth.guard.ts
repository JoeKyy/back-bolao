import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { naoAutenticado } from "../common/erros";
import { COOKIE_SESSAO } from "../common/cookies";
import { AuthService } from "./auth.service";

export type RequestComAdmin = Request & { adminId?: number };

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
    const id = await this.auth.validar(lerCookie(req, COOKIE_SESSAO));
    if (!id) throw naoAutenticado();
    req.adminId = id;
    return true;
  }
}
