import { HttpException, HttpStatus } from "@nestjs/common";
import type { ErroApi } from "../shared/tipos";

/**
 * Erro de negócio com código e mensagem FIXOS (BOL-03): nada do que o cliente mandou volta
 * ecoado na mensagem. O front mostra `mensagem` como texto, nunca como HTML.
 */
export class ErroNegocio extends HttpException {
  constructor(status: HttpStatus, codigo: string, mensagem: string) {
    const corpo: ErroApi = { codigo, mensagem };
    super(corpo, status);
  }
}

export const naoEncontrado = (mensagem = "Não encontrado.") =>
  new ErroNegocio(HttpStatus.NOT_FOUND, "nao_encontrado", mensagem);

export const invalido = (codigo: string, mensagem: string) =>
  new ErroNegocio(HttpStatus.BAD_REQUEST, codigo, mensagem);

export const conflito = (codigo: string, mensagem: string) =>
  new ErroNegocio(HttpStatus.CONFLICT, codigo, mensagem);

export const proibido = (mensagem = "Sem permissão.") =>
  new ErroNegocio(HttpStatus.FORBIDDEN, "proibido", mensagem);

export const naoAutenticado = (mensagem = "Entre novamente.") =>
  new ErroNegocio(HttpStatus.UNAUTHORIZED, "nao_autenticado", mensagem);

export const muitasTentativas = (mensagem: string) =>
  new ErroNegocio(HttpStatus.TOO_MANY_REQUESTS, "muitas_tentativas", mensagem);
