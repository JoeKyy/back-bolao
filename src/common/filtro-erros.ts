import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";
import type { ErroApi } from "../shared/tipos";

/** Erros do body-parser (JSON malformado, corpo grande) chegam como Error com status 4xx. */
function erroDoBodyParser(e: unknown): e is { status: number } {
  if (!e || typeof e !== "object") return false;
  const o = e as { status?: unknown; type?: unknown };
  return typeof o.status === "number" && o.status >= 400 && o.status < 500 && typeof o.type === "string";
}

/**
 * Toda resposta de erro sai no formato { codigo, mensagem } com texto fixo. Erro inesperado
 * vira 500 genérico; o detalhe vai só para o log do servidor.
 */
@Catch()
export class FiltroErros implements ExceptionFilter {
  private readonly log = new Logger("Erro");

  catch(exc: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let corpo: ErroApi = { codigo: "erro_interno", mensagem: "Algo deu errado. Tente de novo." };

    if (exc instanceof HttpException) {
      status = exc.getStatus();
      const r = exc.getResponse();
      if (typeof r === "object" && r && "codigo" in r && "mensagem" in r) {
        corpo = r as ErroApi;
      } else if (status === HttpStatus.BAD_REQUEST) {
        // Falha do ValidationPipe: a lista de campos do class-validator não é mostrada ao usuário.
        corpo = { codigo: "entrada_invalida", mensagem: "Dados inválidos. Confira o formulário." };
      } else if (status === HttpStatus.NOT_FOUND) {
        corpo = { codigo: "nao_encontrado", mensagem: "Não encontrado." };
      } else if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        corpo = { codigo: "corpo_grande", mensagem: "Envio grande demais." };
      } else {
        corpo = { codigo: "erro_http", mensagem: "Não foi possível concluir." };
      }
    } else if (erroDoBodyParser(exc)) {
      status = exc.status;
      corpo =
        status === HttpStatus.PAYLOAD_TOO_LARGE
          ? { codigo: "corpo_grande", mensagem: "Envio grande demais." }
          : { codigo: "entrada_invalida", mensagem: "Dados inválidos. Confira o formulário." };
    } else {
      this.log.error(exc instanceof Error ? exc.stack ?? exc.message : String(exc));
    }
    res.status(status).json(corpo);
  }
}
