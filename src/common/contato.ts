/**
 * Telefone brasileiro: DDD + 8 dígitos (fixo) ou 9 + 8 dígitos (celular), com +55 e símbolos
 * opcionais; vazio vale (o campo é opcional). Mesma regra do front (lib/contato.ts).
 */
export const WHATSAPP_RE = /^\s*$|^\s*(\+?55\s*)?\(?[1-9][1-9]\)?\s*(9\s*)?\d{4}[-\s]?\d{4}\s*$/;
