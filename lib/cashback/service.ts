import { ALFABETO, hojeEmBrasilia, situacaoDoCupom, type SituacaoCupom } from "@/lib/coupons/lote";
import { createCoupon, getOrder, listCoupons, NuvemshopError, updateCoupon, type NuvemshopClient, type Order } from "@/lib/nuvemshop";
import { separarTelefone } from "@/lib/customers/map";
import { linkEmail, linkWhatsapp } from "@/lib/carts/logic";
import { somarDias } from "@/lib/orders/stats";
import type { Db } from "@/lib/sync/repo";
import { gastoDoMes, obterConfig, pedidosElegiveis, type Grant } from "./repo";
import { MAX_POR_CHAMADA, cabeNoOrcamento, mensagemDoCashback } from "./rules";

const aleatorio = (): number => crypto.getRandomValues(new Uint8Array(1))[0]! & 31;
const codigoCashback = (): string => `CASH${Array.from({ length: 6 }, () => ALFABETO[aleatorio()]).join("")}`;
const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const erroTexto = (err: unknown) => (err instanceof NuvemshopError ? err.userMessage : err instanceof Error ? err.message : String(err));
const semPermissao = (err: unknown) => err instanceof NuvemshopError && (err.status === 401 || err.status === 403);

export interface ResultadoEmissao {
  orderId: string;
  ok: boolean;
  codigo?: string;
  valor?: number;
  erro?: string;
}

/**
 * Emite os cupons de cashback dos pedidos pedidos (até 5 por chamada). Tudo é reavaliado AQUI, no servidor: elegibilidade, risco, orçamento do mês
 * e a situação do pedido na loja. Cada cupom é de valor fixo, uso único, com validade e compra mínima. Para na hora se a loja negar permissão.
 */
export async function emitirCashback(db: Db, client: NuvemshopClient, args: { storeId: string; actor: string; ids: string[] }): Promise<ResultadoEmissao[]> {
  const ids = [...new Set(args.ids)].slice(0, MAX_POR_CHAMADA);
  const cfg = await obterConfig(db, args.storeId);
  const elegiveis = new Map((await pedidosElegiveis(db, args.storeId, cfg, ids)).map((p) => [p.id, p]));
  let gasto = await gastoDoMes(db, args.storeId);
  const out: ResultadoEmissao[] = [];
  let parar: string | null = null;

  for (const id of ids) {
    if (parar) {
      out.push({ orderId: id, ok: false, erro: parar });
      continue;
    }
    const p = elegiveis.get(id);
    if (!p) {
      out.push({ orderId: id, ok: false, erro: "Este pedido não é mais elegível (já recebeu, a cliente já ganhou um cupom há pouco, ou a situação mudou)." });
      continue;
    }
    if (p.retido) {
      out.push({ orderId: id, ok: false, erro: `Retido para conferência: ${p.sinais.join("; ")}.` });
      continue;
    }
    if (!cabeNoOrcamento(gasto, p.valor, cfg)) {
      parar = "O orçamento de cashback do mês acabou. Aumente o orçamento na tela se quiser continuar.";
      out.push({ orderId: id, ok: false, erro: parar });
      continue;
    }
    try {
      const pedido = await getOrder(client, Number(id));
      if (pedido.payment_status !== "paid" || pedido.status === "cancelled") {
        out.push({ orderId: id, ok: false, erro: "Na loja, este pedido já não está pago e ativo. Atualize os pedidos." });
        continue;
      }
      const hoje = hojeEmBrasilia();
      const fim = somarDias(hoje, cfg.validDays);
      let codigo: string | null = null;
      let cupomId: number | null = null;
      let ultimoErro: unknown;
      for (let i = 0; i < 3 && !codigo; i++) {
        const tentativa = codigoCashback();
        try {
          const c = await createCoupon(client, {
            code: tentativa,
            type: "absolute",
            value: p.valor.toFixed(2),
            valid: true,
            max_uses: 1,
            start_date: hoje,
            end_date: fim,
            min_price: cfg.minPurchase > 0 ? cfg.minPurchase.toFixed(2) : null,
            first_consumer_purchase: false,
            combines_with_other_discounts: false,
          });
          codigo = tentativa;
          cupomId = c.id;
        } catch (err) {
          ultimoErro = err;
          if (semPermissao(err)) throw err;
        }
      }
      if (!codigo) throw ultimoErro;
      const gravado = await db.query<{ order_id: string }>(
        `INSERT INTO cashback_grants (store_id, order_id, order_number, coupon_id, coupon_code, value, expires_on, issued_by)
         VALUES ($1::uuid, $2::bigint, $3, $4, $5, $6, $7::date, $8) ON CONFLICT (store_id, order_id) DO NOTHING RETURNING order_id::text`,
        [args.storeId, id, p.numero, cupomId, codigo, p.valor, fim, args.actor],
      );
      if (gravado.length === 0) {
        // outra chamada emitiu para este pedido ao mesmo tempo: desfaz o cupom que acabou de criar
        if (cupomId !== null) await updateCoupon(client, cupomId, { valid: false }).catch(() => undefined);
        out.push({ orderId: id, ok: false, erro: "Este pedido acabou de receber um cupom em outra chamada." });
        continue;
      }
      gasto += p.valor;
      await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso) VALUES ($1::uuid, $2, 'cashback.emitir', 'pedido', $3, $4::jsonb, true)`, [
        args.storeId,
        args.actor,
        id,
        JSON.stringify({ pedido: p.numero, codigo, valor: p.valor, validade: fim }),
      ]);
      out.push({ orderId: id, ok: true, codigo, valor: p.valor });
    } catch (err) {
      out.push({ orderId: id, ok: false, erro: erroTexto(err) });
      if (semPermissao(err)) parar = "A loja não permitiu criar cupons (confira a permissão do app).";
    }
  }
  return out;
}

/** Nome e contato da cliente, lidos do pedido na loja agora (nada disso é guardado no painel). */
export function contatoDoPedido(o: Order): { primeiroNome: string | null; whatsapp: string | null; email: string | null } {
  const c = (o.customer ?? {}) as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  const nome = texto(c.name) ?? texto((o as Record<string, unknown>).contact_name);
  const tel = separarTelefone(texto(c.phone) ?? texto((o as Record<string, unknown>).contact_phone));
  const digitos = tel.mobile ?? tel.phone;
  const email = (texto(c.email) ?? texto((o as Record<string, unknown>).contact_email))?.toLowerCase() ?? null;
  const primeiro = nome ? nome.replace(/\s+/g, " ").split(" ")[0]! : null;
  return {
    primeiroNome: primeiro ? primeiro.charAt(0).toLocaleUpperCase("pt-BR") + primeiro.slice(1).toLocaleLowerCase("pt-BR") : null,
    whatsapp: digitos ? `55${digitos}` : null,
    email: email && email.includes("@") ? email : null,
  };
}

export class CashbackNaoEncontradoError extends Error {}

export interface MensagemCashback {
  mensagem: string;
  whatsapp: string | null;
  email: string | null;
}

/** Texto pronto para a cliente de um cupom já emitido. Lê o contato do pedido na loja agora; não envia nada. */
export async function mensagemDoCupom(db: Db, client: NuvemshopClient, args: { storeId: string; orderId: string }): Promise<MensagemCashback> {
  const [g] = await db.query<Grant>(
    `SELECT order_id::text, order_number, coupon_id::text, coupon_code, value::text, expires_on::text, issued_at::text, issued_by, contacted_at::text, cancelled_at::text
     FROM cashback_grants WHERE store_id = $1::uuid AND order_id = $2::bigint`,
    [args.storeId, args.orderId],
  );
  if (!g || g.cancelled_at) throw new CashbackNaoEncontradoError("Cupom não encontrado ou já cancelado.");
  const cfg = await obterConfig(db, args.storeId);
  const contato = contatoDoPedido(await getOrder(client, Number(args.orderId)));
  const mensagem = mensagemDoCashback({ primeiroNome: contato.primeiroNome, codigo: g.coupon_code, valor: Number(g.value), validade: dataBr(g.expires_on), compraMinima: cfg.minPurchase });
  return {
    mensagem,
    whatsapp: contato.whatsapp ? linkWhatsapp(contato.whatsapp, mensagem) : null,
    email: contato.email ? linkEmail(contato.email, "Um presente da Donatelle Concept", mensagem) : null,
  };
}

export async function marcarContatada(db: Db, args: { storeId: string; actor: string; orderId: string; contatada: boolean }): Promise<boolean> {
  const rows = await db.query<{ order_id: string }>(
    `UPDATE cashback_grants SET contacted_at = CASE WHEN $3::boolean THEN now() ELSE NULL END WHERE store_id = $1::uuid AND order_id = $2::bigint RETURNING order_id::text`,
    [args.storeId, args.orderId, args.contatada],
  );
  return rows.length > 0;
}

/** Cancela o cupom: desativa na loja (`valid: false`, não apaga) e tira do orçamento do mês. */
export async function cancelarCupom(db: Db, client: NuvemshopClient, args: { storeId: string; actor: string; orderId: string }): Promise<void> {
  const [g] = await db.query<{ coupon_id: string | null; coupon_code: string; cancelled_at: string | null }>(
    "SELECT coupon_id::text, coupon_code, cancelled_at::text FROM cashback_grants WHERE store_id = $1::uuid AND order_id = $2::bigint",
    [args.storeId, args.orderId],
  );
  if (!g) throw new CashbackNaoEncontradoError("Cupom não encontrado.");
  if (g.cancelled_at) return;
  if (g.coupon_id) await updateCoupon(client, Number(g.coupon_id), { valid: false });
  await db.query("UPDATE cashback_grants SET cancelled_at = now() WHERE store_id = $1::uuid AND order_id = $2::bigint", [args.storeId, args.orderId]);
  await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois, sucesso) VALUES ($1::uuid, $2, 'cashback.cancelar', 'pedido', $3, $4::jsonb, true)`, [
    args.storeId,
    args.actor,
    args.orderId,
    JSON.stringify({ codigo: g.coupon_code }),
  ]);
}

export interface SituacaoDoGrant {
  situacao: SituacaoCupom | "cancelado" | "desconhecida";
  usado: boolean;
}

/** Situação de cada cupom emitido, lida da loja agora (até 1.000 cupons): ativo, usado, vencido… Falha de leitura devolve "desconhecida". */
export async function situacaoDosCupons(client: NuvemshopClient, grants: Grant[]): Promise<{ porPedido: Map<string, SituacaoDoGrant>; lido: boolean }> {
  const porCodigo = new Map<string, { situacao: SituacaoCupom; usado: boolean }>();
  let lido = true;
  try {
    const hoje = hojeEmBrasilia();
    for (let page = 1; page <= 5; page++) {
      const r = await listCoupons(client, { page });
      for (const c of r.items) if (c.code.toUpperCase().startsWith("CASH")) porCodigo.set(c.code.toUpperCase(), { situacao: situacaoDoCupom(c, hoje), usado: Number(c.used ?? 0) > 0 });
      if (r.nextPage === null) break;
    }
  } catch {
    lido = false;
  }
  const porPedido = new Map<string, SituacaoDoGrant>();
  for (const g of grants) {
    if (g.cancelled_at) porPedido.set(g.order_id, { situacao: "cancelado", usado: false });
    else {
      const s = porCodigo.get(g.coupon_code.toUpperCase());
      porPedido.set(g.order_id, s ?? { situacao: "desconhecida", usado: false });
    }
  }
  return { porPedido, lido };
}
