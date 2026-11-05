import { escapar, montarEmail } from "./layout";

const base = {
  titulo: "Defina uma nova senha",
  paragrafos: ["Olá, Ana. Use o botão abaixo."],
  acao: { texto: "Escolher nova senha", url: "https://homolog-bolao.joekyy.com.br/organizador/abc123", mostrarUrl: true },
  rodape: ["O link vale 7 dias."],
};

describe("montarEmail", () => {
  it("gera HTML e texto com título, botão, link visível e rodapé", () => {
    const { html, texto } = montarEmail(base);
    expect(html).toContain("Defina uma nova senha");
    expect(html).toContain('href="https://homolog-bolao.joekyy.com.br/organizador/abc123"');
    expect(html).toContain("Se o botão não funcionar");
    expect(html).toContain("O link vale 7 dias.");
    expect(texto).toContain("Escolher nova senha: https://homolog-bolao.joekyy.com.br/organizador/abc123");
    expect(texto).not.toMatch(/<[a-z]/i);
  });

  it("escapa nome de pessoa e URL (sem injeção de HTML)", () => {
    const { html } = montarEmail({ ...base, paragrafos: ['Olá, <img src=x onerror=alert(1)> "Ana"'], acao: { texto: "Ir", url: 'https://x.com/?a="><script>' } });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
    expect(escapar("a&b")).toBe("a&amp;b");
  });

  it("sem ação não desenha botão e o pré-cabeçalho é o primeiro parágrafo", () => {
    const { html } = montarEmail({ titulo: "Aviso", paragrafos: ["Primeira linha"] });
    expect(html).not.toContain("border-radius:10px;\">");
    expect(html).toContain('opacity:0;color:transparent;font-size:1px;line-height:1px;">Primeira linha');
  });

  it("todo bloco de texto declara cor (tema escuro do cliente não inverte)", () => {
    const { html } = montarEmail(base);
    expect(html).toContain('<meta name="color-scheme" content="light">');
    for (const tag of html.match(/<(p|h1) style="[^"]*"/g) ?? []) expect(tag).toMatch(/color:#/);
  });
});
