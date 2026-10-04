import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt } from "@/lib/crypto";

const key = randomBytes(32).toString("base64");

describe("crypto AES-256-GCM", () => {
  it("faz round-trip", () => {
    const token = "abc123-token-secreto";
    const enc = encrypt(token, key);
    expect(enc).not.toContain(token);
    expect(enc.startsWith("v1.")).toBe(true);
    expect(decrypt(enc, key)).toBe(token);
  });

  it("usa IV aleatório (mesmo texto gera cifras diferentes)", () => {
    expect(encrypt("x", key)).not.toBe(encrypt("x", key));
  });

  it("falha com chave errada ou dado adulterado", () => {
    const enc = encrypt("x", key);
    expect(() => decrypt(enc, randomBytes(32).toString("base64"))).toThrow();
    const parts = enc.split(".");
    parts[3] = Buffer.from("adulterado").toString("base64url");
    expect(() => decrypt(parts.join("."), key)).toThrow();
  });

  it("rejeita chave com tamanho inválido", () => {
    expect(() => encrypt("x", Buffer.from("curta").toString("base64"))).toThrow(/32 bytes/);
  });
});
