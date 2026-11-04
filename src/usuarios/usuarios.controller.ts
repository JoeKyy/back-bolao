import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Transform } from "class-transformer";
import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { ipDe } from "../auth/auth.controller";
import { AdminGuard, PerfilAdminGuard, type RequestComAdmin } from "../auth/auth.guard";
import { AuthService } from "../auth/auth.service";
import { COOKIE_SESSAO, opcoesCookie } from "../common/cookies";
import { Id } from "../common/id.pipe";
import { UsuariosService } from "./usuarios.service";

const aparar = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
const SEM_CONTROLE = /^[^\u0000-\u001F\u007F]*$/;

class CriarDto {
  @IsEmail() @MaxLength(120)
  email!: string;

  @Transform(aparar) @IsString() @MinLength(2) @MaxLength(60) @Matches(SEM_CONTROLE)
  nome!: string;

  @IsOptional() @IsBoolean()
  admin?: boolean;

  @IsOptional() @IsBoolean()
  tesoureiro?: boolean;
}

class PerfisDto {
  @IsOptional() @IsBoolean()
  admin?: boolean;

  @IsOptional() @IsBoolean()
  tesoureiro?: boolean;
}

class AtivoDto {
  @IsBoolean()
  ativo!: boolean;
}

class AceitarDto {
  /** Só usado em conta nova (convite); na troca de senha o nome não muda. */
  @IsOptional() @Transform(aparar) @IsString() @MinLength(2) @MaxLength(60) @Matches(SEM_CONTROLE)
  nome?: string;

  // Tamanho e conteúdo conferidos por exigirSenhaAceitavel (mensagem própria).
  @IsString() @MaxLength(200)
  senha!: string;
}

/** Página Usuários (como no gestor): só o perfil Administrador. */
@Controller("usuarios")
@UseGuards(AdminGuard, PerfilAdminGuard)
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  listar() {
    return this.usuarios.listar();
  }

  /** Cria a conta (pendente) com os perfis e devolve o link de convite. */
  @Post()
  criar(@Body() dto: CriarDto, @Req() req: RequestComAdmin) {
    return this.usuarios.criar(req.adminId!, dto.email, dto.nome, dto);
  }

  @Patch(":uid/perfis")
  @HttpCode(204)
  async perfis(@Id("uid") uid: number, @Body() dto: PerfisDto, @Req() req: RequestComAdmin) {
    await this.usuarios.alterarPerfis(req.adminId!, uid, dto);
  }

  @Post(":uid/ativo")
  @HttpCode(204)
  async ativo(@Id("uid") uid: number, @Body() dto: AtivoDto, @Req() req: RequestComAdmin) {
    await this.usuarios.definirAtivo(req.adminId!, uid, dto.ativo);
  }

  /** Novo link: convite (conta pendente) ou troca de senha (conta com senha). */
  @Post(":uid/link")
  link(@Id("uid") uid: number, @Req() req: RequestComAdmin) {
    return this.usuarios.link(req.adminId!, uid);
  }
}

/** Quem recebeu o link de convite de organizador (sem sessão). */
@Controller("convite-organizador/:token")
export class ConviteOrganizadorController {
  constructor(
    private readonly usuarios: UsuariosService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  ver(@Param("token") token: string, @Req() req: Request) {
    return this.usuarios.verConvite(token, ipDe(req));
  }

  @Post()
  @HttpCode(200)
  async aceitar(@Param("token") token: string, @Body() dto: AceitarDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const id = await this.usuarios.aceitar(token, dto.nome ?? "", dto.senha, ipDe(req));
    const { token: sessao, expiraEm } = await this.auth.abrirSessao(id);
    res.cookie(COOKIE_SESSAO, sessao, opcoesCookie(expiraEm.getTime() - Date.now()));
    return { ok: true };
  }
}
