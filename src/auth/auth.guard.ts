import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { naoAutenticado, proibido } from "../common/erros";
import { COOKIE_SESSAO } from "../common/cookies";
import { AuthService } from "./auth.service";

/** Requisição com a conta da sessão. `adminId` é o id da conta (qualquer perfil). */
export type RequestComAdmin = Request & { adminId?: number; admin?: boolean; tesoureiro?: boolean };

export const lerCookie = (req: Request, nome: string): string | undefined => {
  const v = (req.cookies as Record<string, unknown> | undefined)?.[nome];
  return typeof v === "string" ? v : undefined;
};

/** Exige sessão válida de qualquer conta (pessoa comum, tesoureiro ou admin). */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequestComAdmin>();
    const s = await this.auth.validar(lerCookie(req, COOKIE_SESSAO));
    if (!s) throw naoAutenticado();
    req.adminId = s.id;
    req.admin = s.admin;
    req.tesoureiro = s.tesoureiro;
    return true;
  }
}

/** Exige o perfil Administrador (gestão de contas e perfis). Usar depois do AdminGuard. */
@Injectable()
export class PerfilAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<RequestComAdmin>();
    if (!req.admin) throw proibido("Só o administrador gerencia usuários.");
    return true;
  }
}

/** Exige o perfil Tesoureiro (criar e administrar bolões). Usar depois do AdminGuard. */
@Injectable()
export class TesoureiroGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<RequestComAdmin>();
    if (!req.tesoureiro) throw proibido("Só tesoureiros criam e administram bolões.");
    return true;
  }
}
