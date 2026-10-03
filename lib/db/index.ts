import "server-only";
import { neon } from "@neondatabase/serverless";
import { getEnv } from "@/lib/env";

type Params = unknown[];

let client: ReturnType<typeof neon> | undefined;

function sqlClient() {
  client ??= neon(getEnv().DATABASE_URL);
  return client;
}

/** Executa SQL parametrizado ($1, $2...) e devolve as linhas. */
export async function query<T = Record<string, unknown>>(text: string, params: Params = []): Promise<T[]> {
  return (await sqlClient().query(text, params)) as T[];
}

export async function queryOne<T = Record<string, unknown>>(text: string, params: Params = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
