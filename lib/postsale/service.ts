import { linkEmail, linkWhatsapp } from "@/lib/carts/logic";
import { separarTelefone } from "@/lib/customers/map";
import type { Db } from "@/lib/sync/repo";
import { marcarAvisada } from "./repo";
import { TIPOS, mensagemDePosVenda, primeiroNome, type TipoMensagem } from "./rules";

export class PosVendaErro extends Error {}

export interface MensagemPosVenda {
  mensagem: string;
  assunto: string;
  whatsapp: string | null;
  email: string | null;
}

/** Texto pronto e links de WhatsApp/e-mail para o pedido. Lê o contato do espelho de clientes na hora e não envia nada. Quem recusou contato não gera mensagem. */
export async function mensagemDoPedido(db: Db, args: { storeId: string; orderId: string; tipo: TipoMensagem }): Promise<MensagemPosVenda> {
  const [p] = await db.query<{ number: number | null; customer_id: string | null; name: string | null; email: string | null; phone: string | null; accepts_marketing: boolean | null; ignored: boolean | null }>(
    `SELECT o.number, o.customer_id::text AS customer_id, c.name, c.email, c.phone, c.accepts_marketing, c.ignored
     FROM orders o LEFT JOIN customers c ON c.store_id = o.store_id AND c.id = o.customer_id
     WHERE o.store_id = $1::uuid AND o.id = $2::bigint`,
    [args.storeId, args.orderId],
  );
  if (!p || !p.customer_id || p.ignored) throw new PosVendaErro("Pedido ou cliente não encontrados. Leia os pedidos e sincronize os clientes em Contatos.");
  if (p.accepts_marketing === false) throw new PosVendaErro("Esta cliente não aceita receber contato de marketing.");
  const [envio] = await db.query<{ dias: number }>(
    `SELECT floor(extract(epoch FROM (now() - coalesce((SELECT max(a.created_at) FROM audit_log a WHERE a.store_id = $1::uuid AND a.acao = 'pedido.enviar' AND a.entidade_id = $2 AND a.sucesso), o.updated_at_remote, o.created_at_remote))) / 86400)::int AS dias
     FROM orders o WHERE o.store_id = $1::uuid AND o.id = $2::bigint`,
    [args.storeId, args.orderId],
  );
  const tel = separarTelefone(p.phone);
  const digitos = tel.mobile ?? tel.phone;
  const email = p.email?.includes("@") ? p.email : null;
  const mensagem = mensagemDePosVenda({ tipo: args.tipo, primeiroNome: primeiroNome(p.name), numero: p.number, diasDesdeEnvio: envio?.dias ?? 0 });
  const assunto = TIPOS[args.tipo].assunto;
  return { mensagem, assunto, whatsapp: digitos ? linkWhatsapp(`55${digitos}`, mensagem) : null, email: email ? linkEmail(email, assunto, mensagem) : null };
}

/** Marca como avisada e registra no Histórico só o fato (sem nome nem contato). */
export async function registrarAvisoPosVenda(db: Db, args: { storeId: string; actor: string; orderId: string }): Promise<void> {
  const [o] = await db.query<{ customer_id: string | null }>("SELECT customer_id::text AS customer_id FROM orders WHERE store_id = $1::uuid AND id = $2::bigint", [args.storeId, args.orderId]);
  if (!o?.customer_id) throw new PosVendaErro("Pedido não encontrado.");
  await marcarAvisada(db, args.storeId, args.orderId, o.customer_id, args.actor);
  await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois) VALUES ($1::uuid, $2, 'posvenda.avisar', 'pedido', $3, '{}'::jsonb)`, [args.storeId, args.actor, args.orderId]);
}
