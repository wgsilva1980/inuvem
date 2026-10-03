export class NuvemshopError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Corpo de erro devolvido pela API (quando houver). */
    readonly body: unknown,
    /** Mensagem original da API, para exibir ao usuário. */
    readonly apiMessage?: string,
  ) {
    super(message);
    this.name = "NuvemshopError";
  }

  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }

  /** Mensagem em pt-BR para a UI, incluindo o texto da API. */
  get userMessage(): string {
    const detail = this.apiMessage ? ` (${this.apiMessage})` : "";
    if (this.status === 0) return `Não foi possível falar com a Nuvemshop${detail}.`;
    if (this.status === 401) return `Acesso negado pela Nuvemshop: token inválido ou revogado. Reconecte a loja${detail}.`;
    if (this.status === 403) return `A Nuvemshop negou a operação: verifique as permissões do app${detail}.`;
    if (this.status === 404) return `Registro não encontrado na Nuvemshop${detail}.`;
    if (this.status === 422) return `A Nuvemshop recusou os dados enviados${detail}.`;
    if (this.status === 429) return `Limite de requisições da Nuvemshop atingido. Tente novamente em instantes${detail}.`;
    if (this.status >= 500) return `A Nuvemshop está instável no momento. Tente novamente${detail}.`;
    return `Erro da Nuvemshop (${this.status})${detail}.`;
  }
}

/** Extrai a mensagem útil do corpo de erro da API ({code,message,description} ou {campo:[msgs]}). */
export function extractApiMessage(body: unknown): string | undefined {
  if (!body) return undefined;
  if (typeof body === "string") return body.slice(0, 500);
  if (typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof b.description === "string") parts.push(b.description);
  else if (typeof b.message === "string") parts.push(b.message);
  if (parts.length === 0) {
    for (const [field, value] of Object.entries(b)) {
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) parts.push(`${field}: ${value.join(", ")}`);
    }
  }
  return parts.length ? parts.join("; ").slice(0, 500) : undefined;
}
