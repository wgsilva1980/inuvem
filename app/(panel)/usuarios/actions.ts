"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/admin";
import { AdminUserError, addAdmin, removeAdmin } from "@/lib/auth/admin-users";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";

export interface UserActionState {
  ok?: boolean;
  message?: string;
}

const fail = (err: unknown): UserActionState => {
  if (err instanceof AdminUserError) return { message: err.message };
  console.error(JSON.stringify({ level: "error", event: "admin.users.failed", message: err instanceof Error ? err.message : String(err) }));
  return { message: "Falha inesperada. Tente novamente." };
};

export async function addUser(_prev: UserActionState | null, formData: FormData): Promise<UserActionState> {
  const admin = await requireAdmin();
  try {
    const store = await getActiveStore();
    const r = await addAdmin({ query }, { actor: admin.email, email: String(formData.get("email") ?? ""), storeId: store?.id ?? null });
    revalidatePath("/usuarios");
    return { ok: true, message: r.created ? `${r.email} agora tem acesso. Para entrar, é só pedir o link de acesso na tela de login.` : `${r.email} já tinha acesso.` };
  } catch (err) {
    return fail(err);
  }
}

export async function removeUser(email: string): Promise<UserActionState> {
  const admin = await requireAdmin();
  try {
    const store = await getActiveStore();
    await removeAdmin({ query }, { actor: admin.email, email, storeId: store?.id ?? null });
    revalidatePath("/usuarios");
    return { ok: true, message: `Acesso de ${email} removido.` };
  } catch (err) {
    return fail(err);
  }
}
