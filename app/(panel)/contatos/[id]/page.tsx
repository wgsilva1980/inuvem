import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import { Alert } from "@/components/ui/alert";
import { getContact } from "@/lib/contacts/repo";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { ContactForm } from "../contact-form";

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

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-32">
      <div className="flex flex-col gap-1">
        <Link href="/contatos" className="text-sm text-muted hover:underline">
          ← Contatos
        </Link>
        <h1 className="text-xl font-semibold">{contact.name}</h1>
      </div>
      {criado === "1" && <Alert tone="success">Contato cadastrado.</Alert>}
      {/* `key` recria o formulário se o contato mudar (ex.: salvo em outra aba). */}
      <ContactForm key={JSON.stringify(contact)} contact={contact} />
    </main>
  );
}
