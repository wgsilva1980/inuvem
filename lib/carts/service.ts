import { hojeEmBrasilia } from "@/lib/coupons/lote";
import { createCoupon, getCheckout, listCheckouts, type NuvemshopClient } from "@/lib/nuvemshop";
import { somarDias } from "@/lib/orders/stats";
import type { Db } from "@/lib/sync/repo";
import { ALFABETO } from "@/lib/coupons/lote";
import { linkEmail, linkWhatsapp, normalizarCarrinho, type Carrinho } from "./logic";
import { criarGeradorMensagem, mensagemPadrao, type CupomDaMensagem, type GeradorMensagem } from "./message";

/** Dias de carrinhos lidos da loja. */
export const JANELA_CARRINHOS_DIAS = 14;
const MAX_PAGINAS = 5;

export class CarrinhoNaoEncontradoError extends Error {
  constructor() {
    super("Carrinho não encontrado na loja (talvez a compra já tenha sido concluída).");
  }
}

/** Carrinhos abandonados dos últimos dias, lidos da loja na hora (nome e contato não são guardados). */
export async function listarCarrinhos(client: NuvemshopClient): Promise<{ carrinhos: Carrinho[]; campos: string[]; truncado: boolean }> {
  const desde = new Date(Date.now() - JANELA_CARRINHOS_DIAS * 86_400_000).toISOString();
  const carrinhos: Carrinho[] = [];
  const campos = new Set<string>();
  let page: number | null = 1;
  for (let i = 0; page !== null && i < MAX_PAGINAS; i++) {
    const r = await listCheckouts(client, { page, created_at_min: desde });
    for (const c of r.campos) campos.add(c);
    for (const raw of r.items) {
      const n = normalizarCarrinho(raw);
      if (n) carrinhos.push(n);
    }
    page = r.nextPage;
  }
  return { carrinhos, campos: [...campos].sort(), truncado: page !== null };
}

export interface ContatoCarrinho {
  contatadoEm: string | null;
  por: string | null;
  cupom: string | null;
}

export async function contatosDosCarrinhos(db: Db, storeId: string, ids: number[]): Promise<Map<number, ContatoCarrinho>> {
  if (ids.length === 0) return new Map();
  const rows = await db.query<{ checkout_id: string; contacted_at: string | null; contacted_by: string | null; coupon_code: string | null }>(
    "SELECT checkout_id::text, contacted_at::text, contacted_by, coupon_code FROM cart_contacts WHERE store_id = $1::uuid AND checkout_id = ANY($2::bigint[])",
    [storeId, ids],
  );
  return new Map(rows.map((r) => [Number(r.checkout_id), { contatadoEm: r.contacted_at, por: r.contacted_by, cupom: r.coupon_code }]));
}

export async function marcarContatado(db: Db, args: { storeId: string; actor: string; id: number; contatado: boolean }): Promise<void> {
  await db.query(
    `INSERT INTO cart_contacts (store_id, checkout_id, contacted_at, contacted_by) VALUES ($1::uuid, $2::bigint, ${args.contatado ? "now()" : "NULL"}, ${args.contatado ? "$3" : "NULL"})
     ON CONFLICT (store_id, checkout_id) DO UPDATE SET contacted_at = ${args.contatado ? "now()" : "NULL"}, contacted_by = ${args.contatado ? "$3" : "NULL"}`,
    args.contatado ? [args.storeId, args.id, args.actor] : [args.storeId, args.id],
  );
  await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois) VALUES ($1::uuid, $2, 'carrinho.contatar', 'carrinho', $3, $4::jsonb)`, [
    args.storeId,
    args.actor,
    String(args.id),
    JSON.stringify({ contatado: args.contatado }),
  ]);
}

const aleatorio = (): number => crypto.getRandomValues(new Uint8Array(1))[0]! & 31;
const codigoVolte = (): string => `VOLTE${Array.from({ length: 6 }, () => ALFABETO[aleatorio()]).join("")}`;
const dataBr = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

export interface PedidoCupom {
  percent: number;
  dias: number;
}

export interface MensagemPronta {
  mensagem: string;
  whatsapp: string | null;
  email: string | null;
  cupom: CupomDaMensagem | null;
  geradaPorIa: boolean;
}

/**
 * Monta a mensagem de recuperação de um carrinho: relê o carrinho na loja pelo ID (nunca confia no navegador), cria o cupom de cortesia se
 * pedido (um por carrinho: se já foi gerado, reutiliza) e escreve o texto com o Claude, ou um texto padrão se a chave da API não estiver
 * configurada. Nada é enviado à cliente: a pessoa abre o WhatsApp/e-mail com o texto pronto e decide.
 */
export async function prepararMensagem(
  db: Db,
  client: NuvemshopClient,
  args: { storeId: string; actor: string; id: number; cupom?: PedidoCupom | null; gerador?: GeradorMensagem | null },
): Promise<MensagemPronta> {
  let carrinho: Carrinho | null;
  try {
    carrinho = normalizarCarrinho(await getCheckout(client, args.id));
  } catch {
    carrinho = null;
  }
  if (!carrinho) throw new CarrinhoNaoEncontradoError();

  let cupom: CupomDaMensagem | null = null;
  if (args.cupom) {
    const { percent, dias } = args.cupom;
    const fim = somarDias(hojeEmBrasilia(), dias);
    const [existente] = await db.query<{ coupon_code: string | null }>("SELECT coupon_code FROM cart_contacts WHERE store_id = $1::uuid AND checkout_id = $2::bigint", [args.storeId, args.id]);
    let codigo = existente?.coupon_code ?? null;
    if (!codigo) {
      let ultimoErro: unknown;
      for (let i = 0; i < 3 && !codigo; i++) {
        const tentativa = codigoVolte();
        try {
          await createCoupon(client, { code: tentativa, type: "percentage", value: percent.toFixed(2), valid: true, max_uses: 1, start_date: hojeEmBrasilia(), end_date: fim, combines_with_other_discounts: false });
          codigo = tentativa;
        } catch (err) {
          ultimoErro = err;
        }
      }
      if (!codigo) throw ultimoErro;
      await db.query(
        `INSERT INTO cart_contacts (store_id, checkout_id, coupon_code) VALUES ($1::uuid, $2::bigint, $3)
         ON CONFLICT (store_id, checkout_id) DO UPDATE SET coupon_code = $3`,
        [args.storeId, args.id, codigo],
      );
      await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois) VALUES ($1::uuid, $2, 'carrinho.cupom', 'carrinho', $3, $4::jsonb)`, [
        args.storeId,
        args.actor,
        String(args.id),
        JSON.stringify({ codigo, percent, validade: fim }),
      ]);
    }
    cupom = { codigo, percent, validade: `válido até ${dataBr(fim)}` };
  }

  const gerador = args.gerador === undefined ? (process.env.ANTHROPIC_API_KEY ? criarGeradorMensagem() : null) : args.gerador;
  const mensagem = gerador ? await gerador(carrinho, cupom) : mensagemPadrao(carrinho, cupom);
  return {
    mensagem,
    whatsapp: carrinho.whatsapp ? linkWhatsapp(carrinho.whatsapp, mensagem) : null,
    email: carrinho.email ? linkEmail(carrinho.email, "Seu carrinho na Donatelle Concept", mensagem) : null,
    cupom,
    geradaPorIa: gerador !== null,
  };
}
