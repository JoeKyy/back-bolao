import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Transform } from "class-transformer";
import { IsBoolean, IsEmail, IsString, Matches, MaxLength, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { ipDe } from "../auth/auth.controller";
import { AdminGuard, PapelAdminGuard, type RequestComAdmin } from "../auth/auth.guard";
import { AuthService } from "../auth/auth.service";
import { SENHA_MINIMA } from "../common/config";
import { COOKIE_SESSAO, opcoesCookie } from "../common/cookies";
import { Id } from "../common/id.pipe";
import { OrganizadoresService } from "./organizadores.service";

const aparar = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
const SEM_CONTROLE = /^[^\u0000-\u001F\u007F]*$/;

class ConvidarDto {
  @IsEmail() @MaxLength(120)
  email!: string;

  @Transform(aparar) @IsString() @MinLength(2) @MaxLength(60) @Matches(SEM_CONTROLE)
  nome!: string;
}

class AtivoDto {
  @IsBoolean()
  ativo!: boolean;
}

class AceitarDto {
  @Transform(aparar) @IsString() @MinLength(2) @MaxLength(60) @Matches(SEM_CONTROLE)
  nome!: string;

  @IsString() @MinLength(SENHA_MINIMA) @MaxLength(200)
  senha!: string;
}

/** Gestão das contas de organizador: só o ADMIN. */
@Controller("organizadores")
@UseGuards(AdminGuard, PapelAdminGuard)
export class OrganizadoresController {
  constructor(private readonly orgs: OrganizadoresService) {}

  @Get()
  listar() {
    return this.orgs.listar();
  }

  @Post("convites")
  convidar(@Body() dto: ConvidarDto) {
    return this.orgs.convidar(dto.email, dto.nome);
  }

  @Post(":uid/ativo")
  @HttpCode(204)
  async ativo(@Id("uid") uid: number, @Body() dto: AtivoDto, @Req() req: RequestComAdmin) {
    await this.orgs.definirAtivo(req.adminId!, uid, dto.ativo);
  }

  @Post(":uid/troca-senha")
  trocaSenha(@Id("uid") uid: number) {
    return this.orgs.trocaDeSenha(uid);
  }
}

/** Quem recebeu o link de convite de organizador (sem sessão). */
@Controller("convite-organizador/:token")
export class ConviteOrganizadorController {
  constructor(
    private readonly orgs: OrganizadoresService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  ver(@Param("token") token: string, @Req() req: Request) {
    return this.orgs.verConvite(token, ipDe(req));
  }

  @Post()
  @HttpCode(200)
  async aceitar(@Param("token") token: string, @Body() dto: AceitarDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const id = await this.orgs.aceitar(token, dto.nome, dto.senha, ipDe(req));
    const { token: sessao, expiraEm } = await this.auth.abrirSessao(id);
    res.cookie(COOKIE_SESSAO, sessao, opcoesCookie(expiraEm.getTime() - Date.now()));
    return { ok: true };
  }
}
