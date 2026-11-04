import type { NextFunction, Request, Response } from "express";
import type { ErroApi } from "../shared/tipos";

export const CABECALHO_CSRF = "x-bolao";

/**
 * Proteção contra CSRF para quem usa cookie de sessão.
 *
 * 1. Toda escrita (POST, PATCH, PUT, DELETE) precisa do cabeçalho `X-Bolao: 1`. Cabeçalho
 *    customizado força o preflight do CORS, e o CORS só libera as origens do front; um
 *    formulário ou <img> de outro site não consegue mandá-lo.
 * 2. Se o navegador mandou `Origin`, ela precisa estar na lista. Sem `Origin` (curl, servidor)
 *    vale a regra 1.
 */
export function protecaoCsrf(origensPermitidas: string[]) {
  const permitidas = new Set(origensPermitidas);
  return (req: Request, res: Response, next: NextFunction) => {
    const escrita = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (!escrita) return next();
    const origem = req.headers.origin;
    const recusar = () => {
      const corpo: ErroApi = { codigo: "origem_recusada", mensagem: "Requisição recusada." };
      res.status(403).json(corpo);
    };
    if (origem && !permitidas.has(origem)) return recusar();
    if (req.headers[CABECALHO_CSRF] !== "1") return recusar();
    next();
  };
}

/** Nenhuma resposta da API pode ficar em cache de proxy ou navegador. */
export function semCache(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store");
  next();
}
