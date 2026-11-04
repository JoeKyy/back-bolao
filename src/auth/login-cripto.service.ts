import { Injectable } from "@nestjs/common";
import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";

/**
 * Como no gestor: par RSA gerado em memória a cada subida da API (nunca em disco nem no .env).
 * O front busca a chave pública e cifra a senha (RSA-OAEP, SHA-256) antes de enviar, para ela
 * não aparecer em texto puro no corpo montado pelo navegador (DevTools, extensão, proxy que
 * termine o TLS antes da hora). Só serve para uma instância da API; com mais de uma, a chave
 * precisaria ser compartilhada.
 */
@Injectable()
export class LoginCriptoService {
  private readonly par = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  chavePublica(): string {
    return this.par.publicKey;
  }

  /** Lança se o texto não foi cifrado com a chave atual. */
  decifrar(base64: string): string {
    const buf = Buffer.from(base64, "base64");
    if (buf.length !== 256) throw new Error("tamanho inválido");
    return privateDecrypt({ key: this.par.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, buf).toString("utf8");
  }
}
