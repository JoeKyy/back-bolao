import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { SENHA_MINIMA } from "../common/config";
import { COOKIE_ORGANIZADOR, COOKIE_SESSAO, opcoesCookie } from "../common/cookies";
import { AdminGuard, lerCookie, type RequestComAdmin } from "./auth.guard";
import { AuthService } from "./auth.service";

class EntrarDto {
  @IsEmail()
  @MaxLength(120)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  senha!: string;
}

class TrocarSenhaDto {
  @IsString()
  @MaxLength(200)
  atual!: string;

  @IsString()
  @MinLength(SENHA_MINIMA)
  @MaxLength(200)
  nova!: string;
}

const UM_ANO_MS = 365 * 24 * 60 * 60 * 1000;

/** IP já resolvido pelo Express segundo `trust proxy` (nunca o cabeçalho cru). */
export const ipDe = (req: Request) => req.ip ?? req.socket.remoteAddress ?? "desconhecido";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("entrar")
  @HttpCode(200)
  async entrar(@Body() dto: EntrarDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token, expiraEm, aparelho } = await this.auth.entrar(dto.email, dto.senha, ipDe(req), lerCookie(req, COOKIE_ORGANIZADOR));
    res.cookie(COOKIE_SESSAO, token, opcoesCookie(expiraEm.getTime() - Date.now()));
    res.cookie(COOKIE_ORGANIZADOR, aparelho, opcoesCookie(UM_ANO_MS));
    return { ok: true };
  }

  @Post("sair")
  @HttpCode(200)
  async sair(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.sair(lerCookie(req, COOKIE_SESSAO));
    res.clearCookie(COOKIE_SESSAO, { ...opcoesCookie(0), maxAge: undefined });
    return { ok: true };
  }

  @Get("eu")
  @UseGuards(AdminGuard)
  eu() {
    return { organizador: true };
  }

  @Post("senha")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async trocarSenha(@Body() dto: TrocarSenhaDto, @Req() req: RequestComAdmin, @Res({ passthrough: true }) res: Response) {
    await this.auth.trocarSenha(req.adminId!, dto.atual, dto.nova);
    res.clearCookie(COOKIE_SESSAO, { ...opcoesCookie(0), maxAge: undefined });
    return { ok: true };
  }
}
