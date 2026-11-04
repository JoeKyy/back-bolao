// Política de senha no mesmo esquema do gestor (AUD-26 de lá): além do tamanho mínimo, recusa as
// senhas que um atacante tenta primeiro, e o próprio nome ou e-mail. A comparação ignora
// maiúscula, acento e pontuação, e tira números do fim antes de olhar as palavras fracas:
// "Bolao@2026!" cai na mesma regra de "bolao". Aqui o mínimo é 12 (no gestor, 8).
import { SENHA_MINIMA } from "../common/config";
import { invalido } from "../common/erros";

const SENHAS_COMUNS = new Set([
  "123456789012", "12345678", "123456789", "1234567890", "123123123", "12341234", "11111111", "00000000",
  "87654321", "987654321", "qwertyui", "qwerty123", "qwertyuiop", "asdfghjk", "asdfghjkl", "zxcvbnm1",
  "1q2w3e4r", "1q2w3e4r5t", "1q2w3e4r5t6y", "q1w2e3r4", "abc12345", "abcd1234", "abcdefgh", "password",
  "password1", "password123", "passw0rd", "p@ssw0rd", "senha123", "senha1234", "senha12345", "senhasenha",
  "minhasenha", "minhasenha123", "mudar123", "mudar1234", "trocar123", "admin123", "admin1234",
  "administrador", "letmein123", "welcome1", "welcome123", "iloveyou", "football", "futebol123",
  "flamengo", "corinthians", "palmeiras", "saopaulo", "santos123", "gremio123", "vasco1898", "brasil123",
  "brasil2014", "brasileiro", "teamo1234", "deusefiel", "jesus123", "jesuscristo", "mudaragora",
  "teste123", "teste1234", "testando123", "usuario123", "changeme", "computador", "qazwsxedc",
  "qweasdzxc", "zaq12wsx", "1qaz2wsx", "147258369", "321654987", "135792468", "megasena", "megasena123",
  "megadavirada", "megadavirada2026", "bolaodamega", "bolaodamega2026", "bolao123", "bolao2026",
]);

/** Palavras fracas: valem sozinhas ou seguidas só de números/ano. */
const PALAVRAS_FRACAS = new Set([
  "senha", "senhas", "password", "passw0rd", "admin", "administrador", "qwerty", "qwertyui", "abc", "abcd",
  "abcdef", "brasil", "teste", "mudar", "trocar", "bemvindo", "welcome", "usuario", "login", "entrar",
  "acesso", "mestre", "master", "root", "secret", "segredo", "senhaforte", "bolao", "bolaodamega", "mega",
  "megasena", "megadavirada", "virada", "sena", "loteria", "loterias", "caixa", "premio", "sorte",
  "tesoureiro", "organizador", "joekyy",
]);

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function repeticaoOuSequencia(n: string): boolean {
  if (/^(.)\1+$/.test(n)) return true;
  if (/^(.{1,4})\1+$/.test(n)) return true; // "abcabcabcabc", "12121212"
  const sequencias = "0123456789012345678909876543210abcdefghijklmnopqrstuvwxyz";
  return n.length >= 8 && sequencias.includes(n);
}

export const SENHA_MAXIMA = 128;

export type ContextoSenha = { email?: string | null; nome?: string | null };

/** Recusa (400, mensagem fixa) senha curta, comum, sequência, ou igual ao nome/e-mail. */
export function exigirSenhaAceitavel(senha: string, contexto: ContextoSenha = {}): void {
  if (senha.length < SENHA_MINIMA) throw invalido("senha_curta", `A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`);
  // RVAL-02: o login cifra a senha com RSA-OAEP/SHA-256 de 2048 bits, que aceita no máximo 190
  // bytes. Uma senha maior seria aceita no cadastro e nunca mais entraria. Limite em bytes UTF-8.
  if (senha.length > SENHA_MAXIMA || Buffer.byteLength(senha, "utf8") > 190) {
    throw invalido("senha_longa", `A senha pode ter no máximo ${SENHA_MAXIMA} caracteres.`);
  }
  const n = normalizar(senha);
  const semNumerosNoFim = n.replace(/[0-9]+$/, "");
  if (
    SENHAS_COMUNS.has(n) ||
    repeticaoOuSequencia(n) ||
    (semNumerosNoFim.length > 0 && PALAVRAS_FRACAS.has(semNumerosNoFim)) ||
    PALAVRAS_FRACAS.has(n)
  ) {
    throw invalido("senha_comum", "Essa senha é comum demais. Escolha outra, com mais variação.");
  }
  const identidade = [contexto.email?.split("@")[0], ...(contexto.nome ? [contexto.nome, ...contexto.nome.split(/\s+/)] : [])]
    .filter((x): x is string => !!x)
    .map(normalizar)
    .filter((x) => x.length >= 4);
  if (identidade.some((x) => n === x || semNumerosNoFim === x)) {
    throw invalido("senha_pessoal", "A senha não pode ser o seu nome ou o seu e-mail.");
  }
}
