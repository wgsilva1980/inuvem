import { z } from "zod";

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NEON_AUTH_BASE_URL: z.string().url(),
  NEON_AUTH_COOKIE_SECRET: z.string().min(32, "mínimo de 32 caracteres"),
  NUVEMSHOP_APP_ID: z.string().min(1),
  NUVEMSHOP_CLIENT_ID: z.string().min(1),
  NUVEMSHOP_CLIENT_SECRET: z.string().min(1),
  NUVEMSHOP_APP_NAME: z.string().min(1).default("INuvem"),
  NUVEMSHOP_CONTACT_EMAIL: z.string().email(),
  NUVEMSHOP_API_VERSION: z.string().min(1).default("v1"),
  ENCRYPTION_KEY: z.string().min(1),
  CRON_SECRET: z.string().min(16, "mínimo de 16 caracteres"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SYNC_TIME_BUDGET_MS: z.coerce.number().int().min(1000).default(20000),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

/** Valida e devolve as variáveis de ambiente do servidor (lazy: o build não exige segredos). */
export function getEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  if (source === process.env && cached) return cached;
  const parsed = serverSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Variáveis de ambiente inválidas ou ausentes: ${problems}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

export function userAgent(env: Pick<ServerEnv, "NUVEMSHOP_APP_NAME" | "NUVEMSHOP_CONTACT_EMAIL">): string {
  return `${env.NUVEMSHOP_APP_NAME} (${env.NUVEMSHOP_CONTACT_EMAIL})`;
}
