"use server";

import { requireAdmin } from "@/lib/auth/admin";
import { testarArmazenamento, type TesteArmazenamento } from "@/lib/images/storage-test";

export async function testarArmazenamentoAction(): Promise<TesteArmazenamento> {
  await requireAdmin();
  return testarArmazenamento();
}
