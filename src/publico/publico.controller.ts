import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Transform } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { AdminGuard, lerCookie, type RequestComAdmin } from "../auth/auth.guard";
import { ipDe } from "../auth/auth.controller";
import { AuthService } from "../auth/auth.service";
import { WHATSAPP_RE } from "../common/contato";
import { COOKIE_DISPOSITIVO, COOKIE_SESSAO, opcoesCookie } from "../common/cookies";
import { IdPipe } from "../common/id.pipe";
import { PublicoService, type Identidade } from "./publico.service";
import { AcessoService } from "./acesso.service";
import { VinculoService } from "./vinculo.service";

const SEIS_MESES_MS = 180 * 24 * 60 * 60 * 1000;
const aparar = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

class InscricaoDto {
  /** Obrigatório sem conta; logado, vale o nome da conta. */
  @IsOptional() @Transform(aparar) @IsString() @MinLength(2) @MaxLength(60) @Matches(/^[^\u0000-\u001F\u007F]*$/)
  nome?: string;

  @IsOptional() @Transform(aparar) @IsString() @MaxLength(30) @Matches(WHATSAPP_RE)
  whatsapp?: string;
}

class ContaDto {
  @Transform(aparar) @IsEmail() @MaxLength(120)
  email!: string;

  /** Opcional: se vier, a conta já nasce com esta senha quando o e-mail for confirmado. */
  @IsOptional() @IsString() @MaxLength(200)
  senha?: string;
}

class ConfirmarVinculoDto {
  /** Só vale em conta nova; sem ele, vale o nome do participante. */
  @IsOptional() @Transform(aparar) @IsString() @MinLength(2) @MaxLength(60) @Matches(/^[^\u0000-\u001F\u007F]*$/)
  nome?: string;

  /** Só exigida quando ainda não há conta com senha; o tamanho e o conteúdo saem de exigirSenhaAceitavel. */
  @IsOptional() @IsString() @MaxLength(200)
  senha?: string;
}

class JogoParticipanteDto {
  @IsArray() @ArrayMinSize(6) @ArrayMaxSize(20) @IsInt({ each: true })
  dezenas!: number[];

  @IsOptional() @IsBoolean()
  surpresinha?: boolean;
}

/** Rotas do participante, identificado pelo cookie do aparelho e, se logado, pela conta. */
@Controller("convites/:convite")
export class PublicoController {
  constructor(
    private readonly publico: PublicoService,
    private readonly auth: AuthService,
    private readonly vinculo: VinculoService,
  ) {}

  private async quem(req: Request): Promise<Identidade> {
    const s = await this.auth.validar(lerCookie(req, COOKIE_SESSAO));
    return { dispositivo: lerCookie(req, COOKIE_DISPOSITIVO), usuarioId: s?.id ?? null, tesoureiro: s?.tesoureiro ?? false };
  }

  @Get()
  async convite(@Param("convite") convite: string, @Req() req: Request) {
    return this.publico.convite(convite, await this.quem(req));
  }

  @Post("inscricao")
  @HttpCode(200)
  async inscrever(
    @Param("convite") convite: string,
    @Body() dto: InscricaoDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { dispositivo } = await this.publico.inscrever(convite, dto.nome ?? "", dto.whatsapp ?? "", ipDe(req), await this.quem(req));
    if (dispositivo) res.cookie(COOKIE_DISPOSITIVO, dispositivo, opcoesCookie(SEIS_MESES_MS));
    return { ok: true };
  }

  /** Guarda na conta logada a participação deste aparelho. */
  @Post("vincular")
  @HttpCode(204)
  async vincular(@Param("convite") convite: string, @Req() req: Request) {
    await this.publico.vincular(convite, await this.quem(req));
  }

  /**
   * Pede o link para guardar a participação deste aparelho numa conta (e-mail + senha própria).
   * 202 e a mesma mensagem, exista a conta ou não; só a confirmação pelo e-mail liga o bolão.
   */
  @Post("conta")
  @HttpCode(202)
  async pedirConta(@Param("convite") convite: string, @Body() dto: ContaDto, @Req() req: Request) {
    const p = await this.publico.participanteParaConta(convite, await this.quem(req));
    return this.vinculo.pedir(p, dto.email, ipDe(req), dto.senha);
  }

  @Get("painel")
  async painel(@Param("convite") convite: string, @Req() req: Request) {
    return this.publico.painel(convite, await this.quem(req));
  }

  @Post("jogos")
  @HttpCode(204)
  async adicionarJogo(@Param("convite") convite: string, @Body() dto: JogoParticipanteDto, @Req() req: Request) {
    await this.publico.adicionarJogo(convite, await this.quem(req), dto.dezenas, !!dto.surpresinha, ipDe(req));
  }

  @Delete("jogos/:jid")
  @HttpCode(204)
  async removerJogo(@Param("convite") convite: string, @Param("jid", IdPipe) jid: number, @Req() req: Request) {
    await this.publico.removerJogo(convite, await this.quem(req), jid);
  }
}

/** "Meus bolões" da conta logada (qualquer perfil). */
@Controller("participacoes")
@UseGuards(AdminGuard)
export class ParticipacoesController {
  constructor(private readonly publico: PublicoService) {}

  @Get()
  listar(@Req() req: RequestComAdmin) {
    return this.publico.participacoes(req.adminId!);
  }
}

/** Página do link enviado por e-mail: confirma que o e-mail é da pessoa e guarda o bolão na conta. */
@Controller("vinculo/:token")
export class VinculoController {
  constructor(
    private readonly vinculo: VinculoService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  ver(@Param("token") token: string, @Req() req: Request) {
    return this.vinculo.ver(token, ipDe(req));
  }

  @Post()
  @HttpCode(200)
  async confirmar(@Param("token") token: string, @Body() dto: ConfirmarVinculoDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.vinculo.confirmar(token, dto.nome ?? "", dto.senha, ipDe(req));
    if (r.sessao) {
      const { token: sessao, expiraEm } = await this.auth.abrirSessao(r.usuarioId);
      res.cookie(COOKIE_SESSAO, sessao, opcoesCookie(expiraEm.getTime() - Date.now()));
    }
    return { convite: r.convite, sessao: r.sessao };
  }
}

/** Página do link de acesso do organizador: confirmar liga este aparelho à participação. */
@Controller("acesso/:token")
export class AcessoController {
  constructor(private readonly acesso: AcessoService) {}

  @Get()
  ver(@Param("token") token: string, @Req() req: Request) {
    return this.acesso.ver(token, ipDe(req));
  }

  @Post()
  @HttpCode(200)
  async confirmar(@Param("token") token: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.acesso.confirmar(token, ipDe(req));
    res.cookie(COOKIE_DISPOSITIVO, r.dispositivo, opcoesCookie(SEIS_MESES_MS));
    return { convite: r.convite };
  }
}
