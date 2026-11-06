import { BadRequestException, type ValidationError } from "@nestjs/common";
import type { ErroApi } from "../shared/tipos";

// Mensagens FIXAS por tipo de regra (BOL-03): o que o cliente digitou nunca volta na resposta.
// Os números vêm da regra declarada no DTO (ex.: "pelo menos 2"), não do valor enviado.
const numero = (m: string | undefined) => m?.match(/-?\d+/)?.[0] ?? "";

const MOTIVOS: Record<string, (m: string) => string> = {
  isNotEmpty: () => "Preencha este campo.",
  isDefined: () => "Preencha este campo.",
  isString: () => "Preencha este campo.",
  isEmail: () => "Informe um e-mail válido, como nome@exemplo.com.",
  minLength: (m) => `Use pelo menos ${numero(m)} caracteres.`,
  maxLength: (m) => `Use no máximo ${numero(m)} caracteres.`,
  matches: () => "Há caracteres que não são permitidos aqui.",
  isIn: () => "Escolha uma das opções disponíveis.",
  isInt: () => "Informe um número inteiro.",
  isNumber: () => "Informe um número.",
  min: (m) => `O valor mínimo é ${numero(m)}.`,
  max: (m) => `O valor máximo é ${numero(m)}.`,
  isBoolean: () => "Escolha sim ou não.",
  isArray: () => "Formato inválido.",
  arrayMinSize: (m) => `Informe pelo menos ${numero(m)} itens.`,
  arrayMaxSize: (m) => `Informe no máximo ${numero(m)} itens.`,
};

const MAX_CAMPOS = 10;

function coletar(erros: ValidationError[], prefixo: string, saida: Record<string, string>) {
  for (const e of erros) {
    if (Object.keys(saida).length >= MAX_CAMPOS) return;
    const caminho = prefixo ? `${prefixo}.${e.property}` : e.property;
    const regras = Object.entries(e.constraints ?? {});
    if (regras.length) {
      // Nome de campo desconhecido veio do cliente: não é ecoado.
      if (regras.some(([k]) => k === "whitelistValidation")) saida["_"] = "A requisição trouxe um campo que não existe.";
      else {
        // Campo ausente falha em várias regras ao mesmo tempo: "obrigatório" vem primeiro.
        const [tipo, msg] = regras.find(([k]) => k === "isDefined" || k === "isNotEmpty" || k === "isString") ?? regras[0];
        saida[caminho] =
          tipo === "matches" && e.property === "whatsapp"
            ? "Informe o WhatsApp com DDD, como (11) 91234-5678."
            : (MOTIVOS[tipo] ?? (() => "Valor inválido."))(msg);
      }
    }
    if (e.children?.length) coletar(e.children, caminho, saida);
  }
}

/** Para `ValidationPipe({ exceptionFactory })`: devolve 400 com o motivo de cada campo inválido. */
export function falhaDeValidacao(erros: ValidationError[]): BadRequestException {
  const campos: Record<string, string> = {};
  coletar(erros, "", campos);
  const corpo: ErroApi = {
    codigo: "entrada_invalida",
    mensagem: "Dados inválidos. Confira o formulário.",
    campos: Object.keys(campos).length ? campos : undefined,
  };
  return new BadRequestException(corpo);
}
