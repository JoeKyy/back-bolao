import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { COOKIE_ORGANIZADOR, COOKIE_SESSAO, opcoesCookie } from "../common/cookies";
import { naoAutenticado } from "../common/erros";
import { AdminGuard, lerCookie, type RequestComAdmin } from "./auth.guard";
import { AuthService } from "./auth.service";
import { CodigosService } from "./codigos.service";
import { LoginCriptoService } from "./login-cripto.service";

class EntrarDto {
  @IsEmail() @MaxLength(120)
  email!: string;

  /** Senha cifrada com a chave pública (RSA-OAEP/SHA-256, base64). Texto puro é recusado. */
  @IsString() @MinLength(16) @MaxLength(500)
  senhaCifrada!: string;
}

class TrocarSenhaDto {
  @IsString() @MaxLength(200)
  atual!: string;

  // Tamanho e conteúdo conferidos por exigirSenhaAceitavel (mensagem própria).
  @IsString() @MaxLength(128)
  nova!: string;
}

class EsqueciDto {
  @IsEmail() @MaxLength(120)
  email!: string;
}

class SenhaAtualDto {
  @IsString() @MinLength(1) @MaxLength(200)
  senha!: string;
}

class RecuperarDto {
  @IsEmail() @MaxLength(120)
  email!: string;

  @IsString() @MinLength(12) @MaxLength(20)
  codigo!: string;

  @IsString() @MaxLength(128)
  novaSenha!: string;
}

const UM_ANO_MS = 365 * 24 * 60 * 60 * 1000;

/** IP já resolvido pelo Express segundo `trust proxy` (nunca o cabeçalho cru). */
export const ipDe = (req: Request) => req.ip ?? req.socket.remoteAddress ?? "desconhecido";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cripto: LoginCriptoService,
    private readonly codigos: CodigosService,
  ) {}

  /** Chave pública para cifrar a senha do login (muda a cada subida da API). */
  @Get("chave-publica")
  chavePublica() {
    return { chavePublica: this.cripto.chavePublica() };
  }

  @Post("entrar")
  @HttpCode(200)
  async entrar(@Body() dto: EntrarDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    let senha: string;
    try {
      senha = this.cripto.decifrar(dto.senhaCifrada);
    } catch {
      // Chave antiga (API reiniciou) ou cliente que não cifrou: mesma resposta de senha errada.
      throw naoAutenticado("E-mail ou senha incorretos.");
    }
    const { token, expiraEm, aparelho } = await this.auth.entrar(dto.email, senha, ipDe(req), lerCookie(req, COOKIE_ORGANIZADOR));
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
  eu(@Req() req: RequestComAdmin) {
    return this.auth.eu(req.adminId!);
  }

  /** Últimas ações sobre a minha conta (link emitido, perfis, senha). */
  @Get("atividade")
  @UseGuards(AdminGuard)
  atividade(@Req() req: RequestComAdmin) {
    return this.auth.atividade(req.adminId!);
  }

  @Post("senha")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async trocarSenha(@Body() dto: TrocarSenhaDto, @Req() req: RequestComAdmin, @Res({ passthrough: true }) res: Response) {
    await this.auth.trocarSenha(req.adminId!, dto.atual, dto.nova);
    res.clearCookie(COOKIE_SESSAO, { ...opcoesCookie(0), maxAge: undefined });
    return { ok: true };
  }

  /** "Esqueci minha senha": 202 e a mesma mensagem, exista a conta ou não. */
  @Post("esqueci")
  @HttpCode(202)
  async esqueci(@Body() dto: EsqueciDto, @Req() req: Request) {
    await this.auth.esqueci(dto.email, ipDe(req));
    return { mensagem: "Se existir uma conta com esse e-mail, enviamos um link para definir uma nova senha." };
  }

  /** Quantos códigos de recuperação ainda valem. */
  @Get("codigos")
  @UseGuards(AdminGuard)
  async contarCodigos(@Req() req: RequestComAdmin) {
    return { restantes: await this.codigos.contar(req.adminId!) };
  }

  /**
   * Gera 8 códigos novos (os anteriores deixam de valer). Exige a senha atual: uma sessão
   * sequestrada não pode criar chaves reserva que sobrevivem à troca de senha. Os códigos saem
   * em texto puro só nesta resposta.
   */
  @Post("codigos")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async gerarCodigos(@Body() dto: SenhaAtualDto, @Req() req: RequestComAdmin) {
    await this.auth.conferirSenha(req.adminId!, dto.senha);
    return { codigos: await this.codigos.gerar(req.adminId!) };
  }

  /** Troca a senha com um código de recuperação e já entra. */
  @Post("recuperar")
  @HttpCode(200)
  async recuperar(@Body() dto: RecuperarDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const id = await this.codigos.recuperar(dto.email, dto.codigo, dto.novaSenha, ipDe(req));
    const { token, expiraEm } = await this.auth.abrirSessao(id);
    res.cookie(COOKIE_SESSAO, token, opcoesCookie(expiraEm.getTime() - Date.now()));
    return { ok: true };
  }
}
