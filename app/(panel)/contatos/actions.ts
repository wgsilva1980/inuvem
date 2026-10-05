"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { parseContactForm } from "@/lib/contacts/form";
import { createContact, deleteContact, updateContact } from "@/lib/contacts/repo";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";

export interface ContactState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const db = { query };

/** Cria (id ausente) ou atualiza um contato. Depois de criar, vai para a tela do contato. */
export async function saveContact(id: number | null, _prev: ContactState | null, formData: FormData): Promise<ContactState> {
  const admin = await requireAdmin();
  if (id !== null && (!Number.isInteger(id) || id <= 0)) return { message: "Contato inválido." };
  const parsed = parseContactForm(formData);
  if (!parsed.input) return { message: "Corrija os campos destacados.", fieldErrors: parsed.fieldErrors };
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };

  try {
    if (id === null) {
      const newId = await createContact(db, { storeId: store.id, actor: admin.email, input: parsed.input });
      revalidatePath("/contatos");
      redirect(`/contatos/${newId}?criado=1`);
    }
    const found = await updateContact(db, { storeId: store.id, actor: admin.email, id, input: parsed.input });
    if (!found) return { message: "Contato não encontrado." };
    revalidatePath("/contatos");
    revalidatePath(`/contatos/${id}`);
    return { ok: true, message: "Contato salvo." };
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw err;
    console.error(JSON.stringify({ level: "error", event: "contact.save.failed", message: err instanceof Error ? err.message : String(err) }));
    return { message: "Falha inesperada ao salvar o contato." };
  }
}

export async function removeContact(id: number): Promise<ContactState> {
  const admin = await requireAdmin();
  if (!Number.isInteger(id) || id <= 0) return { message: "Contato inválido." };
  const store = await getActiveStore();
  if (!store) return { message: "Nenhuma loja conectada." };
  try {
    const done = await deleteContact(db, { storeId: store.id, actor: admin.email, id });
    if (!done) return { message: "Contato não encontrado." };
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "contact.delete.failed", message: err instanceof Error ? err.message : String(err) }));
    return { message: "Falha inesperada ao excluir o contato." };
  }
  revalidatePath("/contatos");
  redirect("/contatos?excluido=1");
}
