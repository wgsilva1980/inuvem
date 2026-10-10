import { linkEmail, linkWhatsapp } from "@/lib/carts/logic";
import { separarTelefone } from "@/lib/customers/map";
import type { Db } from "@/lib/sync/repo";
import { marcarAvisada } from "./repo";
import { ASSUNTO_REATIVACAO, mensagemDeReativacao, primeiroNome } from "./rules";

export class ClienteNaoEncontradaError extends Error {}

export interface MensagemReativacao {
  mensagem: string;
  assunto: string;
  whatsapp: string | null;
  email: string | null;
}

/** Texto pronto e links de WhatsApp/e-mail. Lê o contato do espelho de clientes na hora e não envia nada. Quem recusou contato não gera mensagem. */
export async function mensagemParaCliente(db: Db, args: { storeId: string; customerId: string }): Promise<MensagemReativacao> {
  const [c] = await db.query<{ name: string | null; email: string | null; phone: string | null; accepts_marketing: boolean | null; ignored: boolean }>(
    "SELECT name, email, phone, accepts_marketing, ignored FROM customers WHERE store_id = $1::uuid AND id = $2::bigint",
    [args.storeId, args.customerId],
  );
  if (!c || c.ignored) throw new ClienteNaoEncontradaError("Cliente não encontrada. Sincronize os clientes em Contatos.");
  if (c.accepts_marketing === false) throw new ClienteNaoEncontradaError("Esta cliente não aceita receber contato de marketing.");
  const tel = separarTelefone(c.phone);
  const digitos = tel.mobile ?? tel.phone;
  const email = c.email?.includes("@") ? c.email : null;
  const mensagem = mensagemDeReativacao({ primeiroNome: primeiroNome(c.name) });
  return {
    mensagem,
    assunto: ASSUNTO_REATIVACAO,
    whatsapp: digitos ? linkWhatsapp(`55${digitos}`, mensagem) : null,
    email: email ? linkEmail(email, ASSUNTO_REATIVACAO, mensagem) : null,
  };
}

/** Marca como avisada e registra no Histórico só o fato (sem nome nem contato). */
export async function registrarAviso(db: Db, args: { storeId: string; actor: string; customerId: string }): Promise<void> {
  const [c] = await db.query<{ id: string }>("SELECT id::text FROM customers WHERE store_id = $1::uuid AND id = $2::bigint", [args.storeId, args.customerId]);
  if (!c) throw new ClienteNaoEncontradaError("Cliente não encontrada.");
  await marcarAvisada(db, args.storeId, args.customerId, args.actor);
  await db.query(`INSERT INTO audit_log (store_id, actor_email, acao, entidade, entidade_id, depois) VALUES ($1::uuid, $2, 'reativacao.avisar', 'cliente', $3, '{}'::jsonb)`, [args.storeId, args.actor, args.customerId]);
}
