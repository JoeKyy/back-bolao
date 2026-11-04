import { Injectable, Param, PipeTransform } from "@nestjs/common";
import { naoEncontrado } from "./erros";

const MAX_INT4 = 2_147_483_647;

/** Id de rota: inteiro de 1 a 2^31-1. Fora disso é 404, nunca 500 do banco (SEC-08). */
@Injectable()
export class IdPipe implements PipeTransform<string, number> {
  transform(v: string): number {
    if (!/^\d{1,10}$/.test(v)) throw naoEncontrado();
    const n = Number(v);
    if (n < 1 || n > MAX_INT4) throw naoEncontrado();
    return n;
  }
}

export const Id = (nome: string) => Param(nome, IdPipe);
