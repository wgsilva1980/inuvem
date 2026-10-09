import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatBRL, formatDate } from "@/lib/contacts/format";
import { getClienteDaLoja, getContact } from "@/lib/contacts/repo";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { ContactForm } from "../contact-form";
import { PedidosCliente } from "../pedidos-cliente";

export const dynamic = "force-dynamic";

export default async function ContatoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ criado?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { criado } = await searchParams;
  const contactId = Number(id);
  if (!Number.isInteger(contactId) || contactId <= 0) notFound();
  const store = await getActiveStore();
  if (!store) notFound();
  const contact = await getContact({ query }, store.id, contactId);
  if (!contact) notFound();
  const cliente = await getClienteDaLoja({ query }, store.id, contactId);

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-32">
      <div className="flex flex-col gap-1">
        <Link href="/contatos" className="text-sm text-muted hover:underline">
          ← Contatos
        </Link>
        <h1 className="text-xl font-semibold">{contact.name}</h1>
      </div>
      {criado === "1" && <Alert tone="success">Contato cadastrado.</Alert>}
      {cliente && (
        <Card>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="font-medium">Dados da loja</h2>
              <Badge tone="success">Cliente da loja</Badge>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted">Total gasto</dt>
                <dd className="font-medium">{formatBRL(cliente.total_spent)}</dd>
              </div>
              <div>
                <dt className="text-muted">Cliente desde</dt>
                <dd className="font-medium">{formatDate(cliente.created_at_remote) || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Aceita novidades</dt>
                <dd className="font-medium">{cliente.accepts_marketing === null ? "—" : cliente.accepts_marketing ? "Sim" : "Não"}</dd>
              </div>
            </dl>
            <PedidosCliente contactId={contactId} />
          </div>
        </Card>
      )}
      {/* `key` recria o formulário se o contato mudar (ex.: salvo em outra aba). */}
      <ContactForm key={JSON.stringify(contact)} contact={contact} />
    </main>
  );
}
