import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import { Transform } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { lerCookie } from "../auth/auth.guard";
import { ipDe } from "../auth/auth.controller";
import { AuthService } from "../auth/auth.service";
import { COOKIE_DISPOSITIVO, COOKIE_SESSAO, opcoesCookie } from "../common/cookies";
import { IdPipe } from "../common/id.pipe";
import { PublicoService } from "./publico.service";

const SEIS_MESES_MS = 180 * 24 * 60 * 60 * 1000;
const aparar = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

class InscricaoDto {
  @Transform(aparar) @IsString() @MinLength(2) @MaxLength(60) @Matches(/^[^\u0000-\u001F\u007F]*$/)
  nome!: string;

  @IsOptional() @Transform(aparar) @IsString() @MaxLength(30) @Matches(/^[0-9()+\-\s]*$/)
  whatsapp?: string;
}

class JogoParticipanteDto {
  @IsArray() @ArrayMinSize(6) @ArrayMaxSize(20) @IsInt({ each: true })
  dezenas!: number[];

  @IsOptional() @IsBoolean()
  surpresinha?: boolean;
}

/** Rotas do participante, identificadas pelo token do convite e pelo cookie do aparelho. */
@Controller("convites/:convite")
export class PublicoController {
  constructor(
    private readonly publico: PublicoService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  convite(@Param("convite") convite: string, @Req() req: Request) {
    return this.publico.convite(convite, lerCookie(req, COOKIE_DISPOSITIVO));
  }

  @Post("inscricao")
  @HttpCode(200)
  async inscrever(
    @Param("convite") convite: string,
    @Body() dto: InscricaoDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { dispositivo } = await this.publico.inscrever(
      convite,
      dto.nome,
      dto.whatsapp ?? "",
      ipDe(req),
      lerCookie(req, COOKIE_DISPOSITIVO),
    );
    res.cookie(COOKIE_DISPOSITIVO, dispositivo, opcoesCookie(SEIS_MESES_MS));
    return { ok: true };
  }

  @Get("painel")
  async painel(@Param("convite") convite: string, @Req() req: Request) {
    const sessao = await this.auth.validar(lerCookie(req, COOKIE_SESSAO));
    return this.publico.painel(convite, lerCookie(req, COOKIE_DISPOSITIVO), sessao?.id ?? null);
  }

  @Post("jogos")
  @HttpCode(204)
  async adicionarJogo(@Param("convite") convite: string, @Body() dto: JogoParticipanteDto, @Req() req: Request) {
    await this.publico.adicionarJogo(convite, lerCookie(req, COOKIE_DISPOSITIVO), dto.dezenas, !!dto.surpresinha, ipDe(req));
  }

  @Delete("jogos/:jid")
  @HttpCode(204)
  async removerJogo(
    @Param("convite") convite: string,
    @Param("jid", IdPipe) jid: number,
    @Req() req: Request,
  ) {
    await this.publico.removerJogo(convite, lerCookie(req, COOKIE_DISPOSITIVO), jid);
  }
}
