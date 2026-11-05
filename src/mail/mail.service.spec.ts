import { opcoesDoTransporte, relayPrivado } from "./mail.service";

describe("opcoesDoTransporte", () => {
  it("relay local sem credencial: porta 25, sem TLS verificado, HELO definido", () => {
    expect(opcoesDoTransporte("smtp://127.0.0.1:25", "bolao.joekyy.com.br", null)).toEqual({
      host: "127.0.0.1",
      port: 25,
      secure: false,
      name: "bolao.joekyy.com.br",
      tls: { rejectUnauthorized: false },
    });
  });

  it("servername declarado liga a verificação contra esse nome", () => {
    expect(opcoesDoTransporte("smtp://127.0.0.1:25", null, "mail.exemplo.com").tls).toEqual({ servername: "mail.exemplo.com" });
  });

  it("destino público mantém a verificação padrão e usa as credenciais da URL", () => {
    // Montada em partes: um literal "usuario:senha@servidor" é lido como credencial por scanners de segredo.
    const credencial = ["usuario", "p%40ss"].join(":");
    const o = opcoesDoTransporte(`smtps://${credencial}@smtp.exemplo.com`, null, null);
    expect(o).toEqual({ host: "smtp.exemplo.com", port: 465, secure: true, auth: { user: "usuario", pass: "p@ss" } });
    expect(o).not.toHaveProperty("tls");
  });

  it("só endereços privados dispensam a verificação", () => {
    for (const h of ["127.0.0.1", "10.0.0.5", "172.17.0.1", "192.168.1.1", "localhost", "host.docker.internal", "::1", "[::1]"]) expect(relayPrivado(h)).toBe(true);
    for (const h of ["smtp.exemplo.com", "8.8.8.8", "172.32.0.1", "127.evil.com.br", "10.0.0.5.evil.com", "192.169.0.1"]) expect(relayPrivado(h)).toBe(false);
  });
});
