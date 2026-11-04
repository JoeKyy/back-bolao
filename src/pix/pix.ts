// Pix "copia e cola" estático (BR Code, padrão EMV do Banco Central). Não há verificação de
// pagamento: o código só garante que o participante paga a chave certa, no valor certo, com um
// identificador que ajuda o organizador a achar o pagamento no extrato.

/** Campo EMV: id + tamanho em 2 dígitos + valor. Valor acima de 99 invalida o código (SEC-03). */
function campo(id: string, valor: string): string {
  if (valor.length > 99) throw new Error(`Campo Pix ${id} com ${valor.length} caracteres (máximo 99).`);
  if (!/^[\x20-\x7E]*$/.test(valor)) throw new Error(`Campo Pix ${id} com caractere fora do ASCII.`);
  return `${id}${String(valor.length).padStart(2, "0")}${valor}`;
}

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), como o manual do BR Code exige. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Tira acento e qualquer caractere fora do ASCII visível; corta no tamanho. */
export function limparTexto(s: string, max: number): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .slice(0, max);
}

export type TipoChave = "email" | "cpf" | "cnpj" | "telefone" | "aleatoria";

/** Normaliza e valida a chave Pix. Devolve null se não reconhecer o formato. */
export function normalizarChave(bruta: string): { chave: string; tipo: TipoChave } | null {
  const s = bruta.trim();
  // E-mail só ASCII: o BR Code conta tamanho em caracteres e não aceita acento (SEC-03).
  if (/^[\x21-\x7E]+$/.test(s) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 77) {
    return { chave: s.toLowerCase(), tipo: "email" };
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return { chave: s.toLowerCase(), tipo: "aleatoria" };
  }
  if (s.startsWith("+")) {
    const d = s.replace(/\D/g, "");
    return /^55\d{10,11}$/.test(d) ? { chave: `+${d}`, tipo: "telefone" } : null;
  }
  const d = s.replace(/\D/g, "");
  if (d.length === 11 && /^[\d.\-\s]+$/.test(s)) return { chave: d, tipo: "cpf" };
  if (d.length === 14 && /^[\d./\-\s]+$/.test(s)) return { chave: d, tipo: "cnpj" };
  return null;
}

export interface DadosPix {
  chave: string;
  nome: string;
  cidade: string;
  /** Centavos. */
  valor: number;
  /** Até 25 caracteres alfanuméricos. */
  identificador: string;
  descricao?: string;
}

export function gerarPix(d: DadosPix): string {
  const txid = d.identificador.replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  const gui = campo("00", "br.gov.bcb.pix");
  const chave = campo("01", d.chave);
  // A descrição é opcional: corta para o campo 26 inteiro caber em 99 (ou some).
  const espaco = 99 - gui.length - chave.length - 4;
  const desc = d.descricao && espaco > 0 ? limparTexto(d.descricao, Math.min(40, espaco)) : "";
  const conta = gui + chave + (desc ? campo("02", desc) : "");
  const valor = d.valor > 0 ? campo("54", (d.valor / 100).toFixed(2)) : "";
  const semCrc =
    campo("00", "01") +
    campo("26", conta) +
    campo("52", "0000") +
    campo("53", "986") +
    valor +
    campo("58", "BR") +
    campo("59", limparTexto(d.nome, 25) || "ORGANIZADOR") +
    campo("60", limparTexto(d.cidade, 15) || "SAO PAULO") +
    campo("62", campo("05", txid)) +
    "6304";
  return semCrc + crc16(semCrc);
}
