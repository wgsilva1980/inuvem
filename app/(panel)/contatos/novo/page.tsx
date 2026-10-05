import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { getActiveStore } from "@/lib/stores";
import { ContactForm } from "../contact-form";

export default async function NovoContatoPage() {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para cadastrar contatos.</p>
      </Card>
    );
  }
  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-32">
      <div className="flex flex-col gap-1">
        <Link href="/contatos" className="text-sm text-muted hover:underline">
          ← Contatos
        </Link>
        <h1 className="text-xl font-semibold">Novo contato</h1>
      </div>
      <ContactForm />
    </main>
  );
}
