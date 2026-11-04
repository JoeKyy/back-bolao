import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AdminGuard } from "../auth/auth.guard";
import { CaixaService } from "../caixa/caixa.service";
import { BoloesService } from "./boloes.service";
import {
  AtualizarBolaoDto,
  CriarBolaoDto,
  ExcluirBolaoDto,
  InscricoesDto,
  JogosDto,
  PagamentoDto,
  ParticipanteDto,
  RegistroJogoDto,
  ResultadoCaixaDto,
  ResultadoManualDto,
} from "./dto";

const Id = (nome: string) => Param(nome, new ParseIntPipe({ errorHttpStatusCode: 404 }));

/** Tudo aqui exige sessão do organizador. */
@Controller()
@UseGuards(AdminGuard)
export class BoloesController {
  constructor(
    private readonly boloes: BoloesService,
    private readonly caixa: CaixaService,
  ) {}

  @Get("boloes")
  listar() {
    return this.boloes.listar();
  }

  @Post("boloes")
  criar(@Body() dto: CriarBolaoDto) {
    return this.boloes.criar(dto);
  }

  @Get("boloes/:id")
  resumo(@Id("id") id: number) {
    return this.boloes.resumo(id);
  }

  @Patch("boloes/:id")
  @HttpCode(204)
  async atualizar(@Id("id") id: number, @Body() dto: AtualizarBolaoDto) {
    await this.boloes.atualizar(id, dto);
  }

  @Post("boloes/:id/excluir")
  @HttpCode(204)
  async excluir(@Id("id") id: number, @Body() dto: ExcluirBolaoDto) {
    await this.boloes.excluir(id, dto.confirmacao);
  }

  @Post("boloes/:id/inscricoes")
  @HttpCode(204)
  async inscricoes(@Id("id") id: number, @Body() dto: InscricoesDto) {
    await this.boloes.definirInscricoes(id, dto.abertas);
  }

  @Post("boloes/:id/convite")
  @HttpCode(204)
  async convite(@Id("id") id: number) {
    await this.boloes.regenerarConvite(id);
  }

  @Post("boloes/:id/participantes")
  adicionarParticipante(@Id("id") id: number, @Body() dto: ParticipanteDto) {
    return this.boloes.adicionarParticipante(id, dto);
  }

  @Patch("boloes/:id/participantes/:pid")
  @HttpCode(204)
  async atualizarParticipante(@Id("id") id: number, @Id("pid") pid: number, @Body() dto: ParticipanteDto) {
    await this.boloes.atualizarParticipante(id, pid, dto);
  }

  @Delete("boloes/:id/participantes/:pid")
  @HttpCode(204)
  async removerParticipante(@Id("id") id: number, @Id("pid") pid: number) {
    await this.boloes.removerParticipante(id, pid);
  }

  @Post("boloes/:id/participantes/:pid/pagamento")
  @HttpCode(204)
  async pagamento(@Id("id") id: number, @Id("pid") pid: number, @Body() dto: PagamentoDto) {
    await this.boloes.definirPagamento(id, pid, dto);
  }

  @Post("boloes/:id/jogos")
  adicionarJogos(@Id("id") id: number, @Body() dto: JogosDto) {
    return this.boloes.adicionarJogos(id, dto);
  }

  @Delete("boloes/:id/jogos/:jid")
  @HttpCode(204)
  async removerJogo(@Id("id") id: number, @Id("jid") jid: number) {
    await this.boloes.removerJogo(id, jid);
  }

  @Post("boloes/:id/jogos/:jid/registro")
  @HttpCode(204)
  async registrarJogo(@Id("id") id: number, @Id("jid") jid: number, @Body() dto: RegistroJogoDto) {
    await this.boloes.registrarJogo(id, jid, dto);
  }

  @Post("boloes/:id/resultado")
  @HttpCode(204)
  async resultadoManual(@Id("id") id: number, @Body() dto: ResultadoManualDto) {
    await this.boloes.resultadoManual(id, dto);
  }

  @Post("boloes/:id/resultado/caixa")
  resultadoCaixa(@Id("id") id: number, @Body() dto: ResultadoCaixaDto) {
    return this.boloes.resultadoCaixa(id, dto.concurso);
  }

  @Delete("boloes/:id/resultado")
  @HttpCode(204)
  async limparResultado(@Id("id") id: number) {
    await this.boloes.limparResultado(id);
  }

  @Get("boloes/:id/eventos")
  eventos(@Id("id") id: number) {
    return this.boloes.eventos(id);
  }

  @Get("boloes/:id/exportar.csv")
  async exportar(@Id("id") id: number, @Res() res: Response) {
    const { nome, csv } = await this.boloes.exportarCsv(id);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${nome}"`);
    res.send(csv);
  }

  /** Consulta direta à Caixa para o organizador (último concurso ou um número). */
  @Get("caixa/megasena")
  ultimo() {
    return this.caixa.concurso();
  }

  @Get("caixa/megasena/:numero")
  porNumero(@Id("numero") numero: number) {
    return this.caixa.concurso(numero);
  }
}
