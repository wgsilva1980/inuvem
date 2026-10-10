export interface CashbackConfig {
  percent: number;
  minOrder: number;
  minPurchase: number;
  maxValue: number;
  validDays: number;
  waitDays: number;
  monthBudget: number;
}

/** Valores de partida, conservadores. Cada um pode ser mudado na tela. */
export const PADRAO: CashbackConfig = { percent: 5, minOrder: 150, minPurchase: 150, maxValue: 100, validDays: 30, waitDays: 7, monthBudget: 500 };

/** Quantos dias depois de um cupom a mesma cliente pode ganhar outro. */
export const INTERVALO_POR_CLIENTE_DIAS = 60;
/** Pedidos mais velhos que isso não entram (o cupom viria tarde demais para ser agradecimento). */
export const IDADE_MAXIMA_DIAS = 60;
export const MAX_POR_CHAMADA = 5;

const cents = (n: number) => Math.round(n * 100);

/** Valor do cupom: percentual do total do pedido, com teto, em reais inteiros para baixo (nunca arredonda a favor da cliente). Mínimo de R$ 1. */
export function valorDoCashback(total: number, c: Pick<CashbackConfig, "percent" | "maxValue">): number {
  const bruto = Math.floor((total * c.percent) / 100);
  return Math.max(1, Math.min(bruto, Math.floor(c.maxValue)));
}

export type Validado = { ok: true; value: CashbackConfig } | { ok: false; error: string };

export function validarConfig(i: Record<keyof CashbackConfig, unknown>): Validado {
  const n = (x: unknown) => (typeof x === "number" ? x : Number(String(x ?? "").replace(",", ".")));
  const c: CashbackConfig = { percent: n(i.percent), minOrder: n(i.minOrder), minPurchase: n(i.minPurchase), maxValue: n(i.maxValue), validDays: n(i.validDays), waitDays: n(i.waitDays), monthBudget: n(i.monthBudget) };
  if (!Number.isFinite(c.percent) || c.percent <= 0 || c.percent > 30) return { ok: false, error: "O percentual deve ser maior que 0 e no máximo 30%." };
  if (!Number.isFinite(c.minOrder) || c.minOrder < 0 || c.minOrder > 100000) return { ok: false, error: "Informe o valor mínimo do pedido (0 ou mais)." };
  if (!Number.isFinite(c.minPurchase) || c.minPurchase < 0 || c.minPurchase > 100000) return { ok: false, error: "Informe a compra mínima para usar o cupom (0 ou mais)." };
  if (!Number.isFinite(c.maxValue) || c.maxValue < 1 || c.maxValue > 10000) return { ok: false, error: "O teto de cada cupom deve ser de R$ 1 a R$ 10.000." };
  if (!Number.isInteger(c.validDays) || c.validDays < 1 || c.validDays > 365) return { ok: false, error: "A validade deve ser de 1 a 365 dias." };
  if (!Number.isInteger(c.waitDays) || c.waitDays < 0 || c.waitDays > 60) return { ok: false, error: "A espera depois do pedido deve ser de 0 a 60 dias." };
  if (!Number.isFinite(c.monthBudget) || c.monthBudget < 0 || c.monthBudget > 1_000_000) return { ok: false, error: "Informe o orçamento do mês (0 ou mais)." };
  return { ok: true, value: { ...c, percent: cents(c.percent) / 100, minOrder: cents(c.minOrder) / 100, minPurchase: cents(c.minPurchase) / 100, maxValue: cents(c.maxValue) / 100, monthBudget: cents(c.monthBudget) / 100 } };
}

/** Cabe no orçamento do mês? `gasto` = soma dos cupons já emitidos no mês (não cancelados). */
export const cabeNoOrcamento = (gasto: number, valor: number, c: Pick<CashbackConfig, "monthBudget">): boolean => cents(gasto) + cents(valor) <= cents(c.monthBudget);

/** Texto para a cliente. Fixo (sem IA): dinheiro e prazo só entram com os números reais do cupom. */
export function mensagemDoCashback(args: { primeiroNome: string | null; codigo: string; valor: number; validade: string; compraMinima: number }): string {
  const reais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const saudacao = args.primeiroNome ? `Oi, ${args.primeiroNome}!` : "Olá!";
  const minimo = args.compraMinima > 0 ? ` em compras a partir de ${reais(args.compraMinima)}` : "";
  return `${saudacao} Obrigada pela sua compra na Donatelle Concept. Como agradecimento, separamos um cupom para a sua próxima compra: ${args.codigo}, de ${reais(args.valor)} de desconto, válido até ${args.validade}${minimo}. Uso único. 💛\n\nDonatelle Concept`;
}
