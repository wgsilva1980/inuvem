import { z } from "zod";
import { decrypt, encrypt } from "@/lib/crypto";

/** Variáveis exigidas em produção, com a regra de cada uma (sem nunca expor valores). */
const rules = {
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "deve começar com postgresql://"),
  NEON_AUTH_BASE_URL: z.string().url("deve ser uma URL"),
  NEON_AUTH_COOKIE_SECRET: z.string().min(32, "mínimo de 32 caracteres"),
  NUVEMSHOP_APP_ID: z.string().min(1),
  NUVEMSHOP_CLIENT_ID: z.string().min(1),
  NUVEMSHOP_CLIENT_SECRET: z.string().min(1),
  NUVEMSHOP_CONTACT_EMAIL: z.string().email("deve ser um e-mail"),
  ENCRYPTION_KEY: z.string().min(1),
  CRON_SECRET: z.string().min(16, "mínimo de 16 caracteres"),
  APP_URL: z.string().url("deve ser uma URL"),
} as const;

export interface EnvReport {
  ok: boolean;
  missing: string[];
  invalid: Array<{ name: string; problem: string }>;
  /** Variáveis "Sensitive" da Vercel: a CLI não baixa o valor, então não dá para validar por arquivo. */
  unverifiable: string[];
  warnings: string[];
}

const SENSITIVE_PLACEHOLDER = /^\[?SENSITIVE\]?$/i;

const PLACEHOLDER = /(SUA_SENHA|USER:PASSWORD|xxx|voce@exemplo|exemplo\.com|seu-app)/i;

export function checkEnv(source: Record<string, string | undefined>): EnvReport {
  const missing: string[] = [];
  const invalid: EnvReport["invalid"] = [];
  const warnings: string[] = [];
  const unverifiable: string[] = [];

  for (const [name, rule] of Object.entries(rules)) {
    const value = source[name];
    if (value === undefined || value.trim() === "") {
      missing.push(name);
      continue;
    }
    if (SENSITIVE_PLACEHOLDER.test(value.trim())) {
      unverifiable.push(name);
      continue;
    }
    // Erro comum: colar o valor com aspas (ou espaços) no painel da Vercel; lá elas viram parte do valor.
    if (/^\s|\s$/.test(value) || /^(["']).*\1$/.test(value.trim())) {
      invalid.push({ name, problem: "o valor tem aspas ou espaços nas pontas; na Vercel cole o valor SEM aspas" });
      continue;
    }
    const parsed = rule.safeParse(value);
    if (!parsed.success) invalid.push({ name, problem: parsed.error.issues[0]?.message ?? "valor inválido" });
    else if (PLACEHOLDER.test(value)) invalid.push({ name, problem: "ainda contém valor de exemplo" });
  }

  // A chave de criptografia precisa realmente funcionar (32 bytes em base64).
  if (source.ENCRYPTION_KEY && !invalid.some((i) => i.name === "ENCRYPTION_KEY") && !unverifiable.includes("ENCRYPTION_KEY")) {
    try {
      if (decrypt(encrypt("teste", source.ENCRYPTION_KEY), source.ENCRYPTION_KEY) !== "teste") throw new Error();
    } catch {
      invalid.push({ name: "ENCRYPTION_KEY", problem: "deve ter exatamente 32 bytes em base64 (openssl rand -base64 32)" });
    }
  }

  const url = source.DATABASE_URL;
  if (url && !/-pooler\./.test(url)) warnings.push("DATABASE_URL não parece ser a connection string pooled (host com -pooler); recomendado na Vercel.");
  if (source.APP_URL?.startsWith("http://") && !/localhost|127\.0\.0\.1/.test(source.APP_URL)) {
    warnings.push("APP_URL usa http:// fora do localhost; a Nuvemshop exige HTTPS.");
  }
  if (source.NUVEMSHOP_APP_ID && source.NUVEMSHOP_CLIENT_ID && source.NUVEMSHOP_APP_ID !== source.NUVEMSHOP_CLIENT_ID) {
    warnings.push("NUVEMSHOP_CLIENT_ID difere do APP_ID; confira no Portal de Parceiros (normalmente são iguais).");
  }

  return { ok: missing.length === 0 && invalid.length === 0 && unverifiable.length === 0, missing, invalid, unverifiable, warnings };
}
