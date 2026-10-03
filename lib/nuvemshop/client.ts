import Bottleneck from "bottleneck";
import { NuvemshopError, extractApiMessage } from "./errors";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Logger {
  info(entry: Record<string, unknown>): void;
  warn(entry: Record<string, unknown>): void;
  error(entry: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  info: (e) => console.log(JSON.stringify({ level: "info", ...e })),
  warn: (e) => console.warn(JSON.stringify({ level: "warn", ...e })),
  error: (e) => console.error(JSON.stringify({ level: "error", ...e })),
};

export interface NuvemshopClientOptions {
  storeId: number | string;
  accessToken: string;
  userAgent: string;
  /** Versão da API na URL (padrão "v1"). */
  apiVersion?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** `null` desliga o limitador (testes). Por padrão há um limitador por loja. */
  limiter?: Bottleneck | null;
  logger?: Logger;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

export interface Page<T> {
  items: T[];
  total: number | null;
  nextPage: number | null;
}

const DEFAULT_BASE = "https://api.nuvemshop.com.br";
const MAX_WAIT_MS = 30_000;

// Leaky bucket da Nuvemshop: 40 requisições, vazão de 2/s por loja+app.
// Usamos reservatório de 30 (folga) recarregando 1 a cada 500 ms.
const limiters = new Map<string, Bottleneck>();
export function limiterForStore(storeId: number | string): Bottleneck {
  const key = String(storeId);
  let l = limiters.get(key);
  if (!l) {
    l = new Bottleneck({
      maxConcurrent: 4,
      reservoir: 30,
      reservoirIncreaseInterval: 500,
      reservoirIncreaseAmount: 1,
      reservoirIncreaseMaximum: 30,
    });
    limiters.set(key, l);
  }
  return l;
}

const IDEMPOTENT = new Set<HttpMethod>(["GET", "PUT", "PATCH", "DELETE"]);

export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(500 * 2 ** attempt, 8000);
  return Math.round(base / 2 + random() * (base / 2));
}

export function parseNextPage(linkHeader: string | null): number | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    if (!/rel="?next"?/.test(part)) continue;
    const url = /<([^>]+)>/.exec(part)?.[1];
    if (!url) continue;
    try {
      const page = new URL(url).searchParams.get("page");
      if (page && Number.isInteger(Number(page))) return Number(page);
    } catch {
      /* URL inválida: ignora */
    }
  }
  return null;
}

export class NuvemshopClient {
  readonly storeId: string;
  private readonly accessToken: string;
  private readonly userAgent: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly limiter: Bottleneck | null;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private pausedUntil = 0;

  constructor(opts: NuvemshopClientOptions) {
    this.storeId = String(opts.storeId);
    this.accessToken = opts.accessToken;
    this.userAgent = opts.userAgent;
    this.baseUrl = `${opts.baseUrl ?? DEFAULT_BASE}/${opts.apiVersion ?? "v1"}/${this.storeId}`;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxRetries = opts.maxRetries ?? 4;
    this.limiter = opts.limiter === undefined ? limiterForStore(this.storeId) : opts.limiter;
    this.logger = opts.logger ?? consoleLogger;
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async request<T = unknown>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const canRetryOnServerError = IDEMPOTENT.has(method);

    for (let attempt = 0; ; attempt++) {
      const wait = this.pausedUntil - Date.now();
      if (wait > 0) await this.sleep(Math.min(wait, MAX_WAIT_MS));

      const started = Date.now();
      let res: Response;
      try {
        res = await this.schedule(() =>
          this.fetchImpl(url, {
            method,
            headers: {
              // Atenção: a Nuvemshop usa "Authentication", e não "Authorization".
              Authentication: `bearer ${this.accessToken}`,
              "User-Agent": this.userAgent,
              "Content-Type": "application/json",
            },
            body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
            signal: AbortSignal.timeout(this.timeoutMs),
          }),
        );
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "falha de rede";
        this.logger.warn({ event: "nuvemshop.network_error", method, path, attempt, error: message });
        // Em POST não sabemos se a criação ocorreu: não repetir.
        if (canRetryOnServerError && attempt < this.maxRetries) {
          await this.sleep(backoffMs(attempt));
          continue;
        }
        throw new NuvemshopError(`Falha de rede: ${message}`, 0, null, message);
      }

      const remaining = headerNumber(res.headers, "x-rate-limit-remaining");
      const reset = headerNumber(res.headers, "x-rate-limit-reset");
      this.logger.info({
        event: "nuvemshop.request",
        method,
        path,
        status: res.status,
        attempt,
        ms: Date.now() - started,
        rateLimitRemaining: remaining,
      });
      // Balde quase vazio: segura as próximas chamadas (429 já espera por conta própria abaixo).
      if (res.status !== 429 && remaining !== undefined && remaining <= 1 && reset !== undefined && reset > 0) {
        this.pausedUntil = Date.now() + Math.min(reset, MAX_WAIT_MS);
      }

      if (res.ok) {
        const data = (await readBody(res)) as T;
        return { data, status: res.status, headers: res.headers };
      }

      const errBody = await readBody(res).catch(() => null);
      const retryable = res.status === 429 || (res.status >= 500 && canRetryOnServerError);
      if (retryable && attempt < this.maxRetries) {
        const delay =
          res.status === 429 && reset !== undefined && reset > 0
            ? Math.min(Math.max(reset, 500), MAX_WAIT_MS)
            : backoffMs(attempt);
        this.logger.warn({ event: "nuvemshop.retry", method, path, status: res.status, attempt, delayMs: delay });
        await this.sleep(delay);
        continue;
      }
      const apiMessage = extractApiMessage(errBody);
      this.logger.error({ event: "nuvemshop.error", method, path, status: res.status, apiMessage });
      throw new NuvemshopError(`Nuvemshop ${method} ${path} falhou (${res.status})`, res.status, errBody, apiMessage);
    }
  }

  get<T>(path: string, query?: RequestOptions["query"]) {
    return this.request<T>("GET", path, { query }).then((r) => r.data);
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>("POST", path, { body }).then((r) => r.data);
  }
  put<T>(path: string, body?: unknown) {
    return this.request<T>("PUT", path, { body }).then((r) => r.data);
  }
  patch<T>(path: string, body?: unknown) {
    return this.request<T>("PATCH", path, { body }).then((r) => r.data);
  }
  async delete(path: string): Promise<void> {
    await this.request("DELETE", path);
  }

  /** Busca uma página de uma listagem (page + per_page; total em x-total-count; próxima via Link). */
  async getPage<T>(path: string, query: RequestOptions["query"] = {}, page = 1, perPage = 200): Promise<Page<T>> {
    try {
      const res = await this.request<T[]>("GET", path, { query: { ...query, page, per_page: Math.min(perPage, 200) } });
      return {
        items: Array.isArray(res.data) ? res.data : [],
        total: headerNumber(res.headers, "x-total-count") ?? null,
        nextPage: parseNextPage(res.headers.get("link")),
      };
    } catch (err) {
      // Listagem vazia / página além da última pode vir como 404 (a confirmar na documentação).
      if (err instanceof NuvemshopError && err.status === 404) return { items: [], total: 0, nextPage: null };
      throw err;
    }
  }

  /** Itera todas as páginas de uma listagem. */
  async *paginate<T>(path: string, query: RequestOptions["query"] = {}, perPage = 200): AsyncGenerator<Page<T>> {
    let page: number | null = 1;
    while (page !== null) {
      const result: Page<T> = await this.getPage<T>(path, query, page, perPage);
      yield result;
      page = result.nextPage ?? (result.items.length >= perPage ? page + 1 : null);
    }
  }

  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    return this.limiter ? this.limiter.schedule(fn) : fn();
  }
}

/** Lê um header numérico; `Number(null)` seria 0, por isso a checagem explícita. */
function headerNumber(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
