/**
 * O DESENHO DOS E-MAILS do Bolão da Mega: um lugar só, no mesmo modelo do gestor de conteúdo.
 *
 * HTML de e-mail é HTML antigo, por necessidade: layout é TABELA (o Outlook não tem flex/grid),
 * estilo vale inline (`<style>` no head é removido por vários clientes), variável CSS não existe,
 * e botão é uma tabela com o link dentro (o Outlook ignora padding em `<a>`).
 *
 * TEMA. O site é claro e verde; o e-mail acompanha. Cada elemento declara `background-color` e
 * `color` explícitos, porque o cliente em modo escuro inverte o que ficou sem cor. Um elemento
 * sem cor já basta para produzir texto claro sobre fundo claro na caixa de alguém.
 */

/** Cores do front (apps/web/src/app/globals.css). A duplicação é deliberada: e-mail não lê var(--brand). */
export const CORES = {
  fundo: "#f6f8f6", // --background
  cartao: "#ffffff", // --card
  texto: "#14211a", // --foreground
  textoFraco: "#5b6b61", // --muted
  borda: "#dfe6e1", // --line
  marca: "#15803d", // --brand
  marcaEscura: "#166534", // --brand-dark
  marcaSuave: "#e7f5ec", // --brand-soft
} as const;

const FONTE = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Escapa o que vira HTML (nome de pessoa entra aqui). */
export function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface Acao {
  texto: string;
  url: string;
  /** Repete o endereço em texto sob o botão. Ligado em e-mail de senha: é o que golpista imita, e poder LER para onde o link vai é a defesa de quem recebe. */
  mostrarUrl?: boolean;
}

export interface Conteudo {
  /** Primeira linha grande: diz o que aconteceu, não "Olá". */
  titulo: string;
  /** Um parágrafo por item. Texto simples, escapado aqui. */
  paragrafos: string[];
  acao?: Acao;
  /** Letra miúda: validade do link, o que fazer se não foi a pessoa. */
  rodape?: string[];
}

// As seis dezenas decorativas do topo: identidade do produto sem depender de imagem (imagens vêm bloqueadas).
const DEZENAS = ["05", "12", "23", "34", "45", "60"];

function dezenasDecorativas(): string {
  const bolinhas = DEZENAS.map(
    (d) =>
      `<td width="34" height="34" align="center" bgcolor="${CORES.marca}" style="width:34px;height:34px;background-color:${CORES.marca};border-radius:17px;font-family:${FONTE};font-size:13px;font-weight:700;line-height:34px;color:#ffffff;">${d}</td>`,
  );
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${bolinhas.join('<td width="6" style="width:6px;font-size:0;line-height:0;">&nbsp;</td>')}</tr></table>`;
}

function botao(acao: Acao): string {
  const url = escapar(acao.url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 6px;">
  <tr>
    <td align="center" bgcolor="${CORES.marca}" style="background-color:${CORES.marca};border-radius:10px;">
      <a href="${url}" style="display:inline-block;padding:14px 28px;font-family:${FONTE};font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:10px;">${escapar(acao.texto)}</a>
    </td>
  </tr>
</table>`;
}

/**
 * Monta o e-mail e devolve as DUAS versões. O texto puro não é sobra: aparece em cliente sem
 * HTML, no preview do celular, e é o que o filtro de spam lê (só-HTML é sinal clássico de spam).
 */
export function montarEmail(c: Conteudo): { html: string; texto: string } {
  const { titulo, paragrafos, acao, rodape } = c;
  const corpo = [
    `<h1 style="margin:22px 0 14px;font-family:${FONTE};font-size:22px;font-weight:800;line-height:1.3;color:${CORES.texto};">${escapar(titulo)}</h1>`,
    ...paragrafos.map((p) => `<p style="margin:0 0 14px;font-family:${FONTE};font-size:15px;line-height:1.6;color:${CORES.textoFraco};">${escapar(p)}</p>`),
    acao ? botao(acao) : "",
    acao?.mostrarUrl
      ? `<p style="margin:18px 0 0;font-family:${FONTE};font-size:12px;line-height:1.6;color:${CORES.textoFraco};">Se o botão não funcionar, copie este endereço no navegador:<br><a href="${escapar(acao.url)}" style="color:${CORES.marcaEscura};text-decoration:underline;word-break:break-all;">${escapar(acao.url)}</a></p>`
      : "",
  ].filter(Boolean);

  const rodapeHtml = rodape?.length
    ? `<tr><td style="padding:0 32px 28px;"><div style="border-top:1px solid ${CORES.borda};padding-top:18px;">${rodape
        .map((l) => `<p style="margin:0 0 6px;font-family:${FONTE};font-size:12px;line-height:1.6;color:${CORES.textoFraco};">${escapar(l)}</p>`)
        .join("")}</div></td></tr>`
    : "";

  // Pré-cabeçalho: o trecho que a caixa de entrada mostra ao lado do assunto.
  const preheader = paragrafos[0] ?? titulo;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapar(titulo)}</title>
</head>
<body style="margin:0;padding:0;background-color:${CORES.fundo};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${escapar(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${CORES.fundo}" style="background-color:${CORES.fundo};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;">
        <tr>
          <td style="padding:0 0 16px 4px;font-family:${FONTE};font-size:18px;font-weight:800;letter-spacing:-0.2px;color:${CORES.marcaEscura};">Bolão da Mega</td>
        </tr>
        <tr>
          <td bgcolor="${CORES.cartao}" style="background-color:${CORES.cartao};border:1px solid ${CORES.borda};border-radius:16px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="padding:30px 32px 24px;">
                  ${dezenasDecorativas()}
                  ${corpo.join("\n                  ")}
                </td>
              </tr>
              ${rodapeHtml}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 4px 0;font-family:${FONTE};font-size:11px;line-height:1.6;color:${CORES.textoFraco};">E-mail automático do Bolão da Mega. Não responda a esta mensagem.</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const texto = [
    titulo,
    "",
    ...paragrafos,
    ...(acao ? ["", `${acao.texto}: ${acao.url}`] : []),
    ...(rodape?.length ? ["", ...rodape] : []),
    "",
    "Bolão da Mega (e-mail automático, não responda)",
  ].join("\n");

  return { html, texto };
}
