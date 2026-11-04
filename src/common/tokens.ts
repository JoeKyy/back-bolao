import crypto from "node:crypto";

/** Token opaco para cookie (32 bytes). No banco fica só o hash. */
export const novoTokenSecreto = () => crypto.randomBytes(32).toString("base64url");

/** Token do link de convite: 12 bytes (96 bits), curto o bastante para WhatsApp. */
export const novoConvite = () => crypto.randomBytes(12).toString("base64url");

export const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

/** Formato válido de token em URL/cookie, para recusar lixo antes de ir ao banco. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;
