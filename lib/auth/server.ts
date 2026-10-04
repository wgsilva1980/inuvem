import { createNeonAuth } from "@neondatabase/auth/next/server";

type NeonAuth = ReturnType<typeof createNeonAuth>;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

let instance: NeonAuth | undefined;

/** Cria a instância sob demanda: o build da Vercel não deve exigir segredos de runtime. */
export function getAuth(): NeonAuth {
  instance ??= createNeonAuth({
    baseUrl: required("NEON_AUTH_BASE_URL"),
    cookies: { secret: required("NEON_AUTH_COOKIE_SECRET") },
  });
  return instance;
}

/** Atalho com a mesma API (`auth.getSession()`, `auth.signIn...`), resolvido de forma preguiçosa. */
export const auth = new Proxy({} as NeonAuth, {
  get(_target, prop) {
    const value = Reflect.get(getAuth(), prop);
    return typeof value === "function" ? value.bind(getAuth()) : value;
  },
});
