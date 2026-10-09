import { z } from "zod";
import type { Coupon, CouponInput } from "@/lib/nuvemshop/coupons";

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataOpcional = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().regex(DATA).nullable());

/** Um lote de cupons: mesmas regras para todos, um código diferente para cada. */
export const loteSchema = z
  .object({
    prefixo: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,12}$/, "O prefixo deve ter de 2 a 12 letras ou números, sem espaços."),
    quantidade: z.number().int().min(1).max(200),
    tipo: z.enum(["percentual", "valor"]),
    valor: z.number().gt(0).max(100000),
    inicio: dataOpcional,
    fim: dataOpcional,
    /** Quantas vezes cada código pode ser usado; null = sem limite. */
    usosPorCupom: z.number().int().min(1).max(1_000_000).nullable(),
    minimo: z.number().min(0).max(1_000_000).nullable(),
    primeiraCompra: z.boolean(),
    combina: z.boolean(),
  })
  .superRefine((l, ctx) => {
    if (l.tipo === "percentual" && l.valor > 100) ctx.addIssue({ code: "custom", path: ["valor"], message: "O desconto em % não pode passar de 100." });
    if (l.inicio && l.fim && l.fim < l.inicio) ctx.addIssue({ code: "custom", path: ["fim"], message: "O fim da validade precisa ser depois do início." });
  });
export type Lote = z.infer<typeof loteSchema>;

export const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem I, O, 0, 1 (não se confundem ao digitar)
export const TAMANHO_SUFIXO = 6;

const aleatorio = (): number => crypto.getRandomValues(new Uint8Array(1))[0]! & 31;

/** Gera `quantidade` códigos PREFIXO + 6 caracteres, sem repetir entre si nem com os `existentes` (comparação sem diferenciar maiúsculas). */
export function gerarCodigos(prefixo: string, quantidade: number, existentes: Iterable<string>, sorteio: () => number = aleatorio): string[] {
  const usados = new Set([...existentes].map((c) => c.toUpperCase()));
  const out: string[] = [];
  let tentativas = 0;
  while (out.length < quantidade) {
    if (++tentativas > quantidade * 50 + 1000) throw new Error("Não consegui gerar códigos únicos; use outro prefixo.");
    let sufixo = "";
    for (let i = 0; i < TAMANHO_SUFIXO; i++) sufixo += ALFABETO[sorteio()];
    const codigo = `${prefixo}${sufixo}`;
    if (usados.has(codigo)) continue;
    usados.add(codigo);
    out.push(codigo);
  }
  return out;
}

/** Um código de um lote precisa começar pelo prefixo e ter só letras maiúsculas e números. */
export const codigoValido = (codigo: string, prefixo: string): boolean => /^[A-Z0-9]{4,40}$/.test(codigo) && codigo.startsWith(prefixo);

export function payloadDoCupom(l: Lote, codigo: string): CouponInput {
  return {
    code: codigo,
    type: l.tipo === "percentual" ? "percentage" : "absolute",
    value: l.valor.toFixed(2),
    valid: true,
    max_uses: l.usosPorCupom,
    start_date: l.inicio,
    end_date: l.fim,
    min_price: l.minimo && l.minimo > 0 ? l.minimo.toFixed(2) : null,
    first_consumer_purchase: l.primeiraCompra,
    combines_with_other_discounts: l.combina,
  };
}

export type SituacaoCupom = "ativo" | "inativo" | "vencido" | "esgotado" | "agendado";

/** Situação de um cupom hoje (`hoje` = AAAA-MM-DD no horário de Brasília). */
export function situacaoDoCupom(c: Coupon, hoje: string): SituacaoCupom {
  if (c.valid === false) return "inativo";
  const fim = c.end_date?.slice(0, 10);
  const inicio = c.start_date?.slice(0, 10);
  if (fim && fim < hoje) return "vencido";
  const max = Number(c.max_uses);
  if (c.max_uses != null && c.max_uses !== "" && Number.isFinite(max) && max > 0 && Number(c.used ?? 0) >= max) return "esgotado";
  if (inicio && inicio > hoje) return "agendado";
  return "ativo";
}

export const SITUACAO_LABEL: Record<SituacaoCupom, string> = { ativo: "Ativo", inativo: "Desativado", vencido: "Vencido", esgotado: "Esgotado", agendado: "Agendado" };

export const hojeEmBrasilia = (agora = new Date()): string => new Date(agora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
