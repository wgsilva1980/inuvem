import { requireAdmin } from "@/lib/auth/admin";
import { listAdmins } from "@/lib/auth/admin-users";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { query } from "@/lib/db";
import { PERFIS } from "@/lib/auth/perfis";
import { AddUserForm, PerfilSelect, RemoveUserButton } from "./user-forms";

export const dynamic = "force-dynamic";

const fmt = (d: string) => new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export default async function UsuariosPage() {
  const me = await requireAdmin();
  const admins = await listAdmins({ query });
  return (
    <main className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Usuários</h1>
        <p className="text-sm text-muted">Quem pode entrar neste painel e o que cada pessoa pode ver. O perfil Administrador tem acesso total (editar, excluir produtos, rodar lotes, custos, clientes, backup); o perfil Expedição e estoque só abre essas duas áreas. O login é por link enviado ao e-mail.</p>
      </div>

      <Card>
        <h2 className="mb-3 text-base font-semibold">Adicionar usuário</h2>
        <AddUserForm />
      </Card>

      <Card className="p-0 sm:p-0">
        <h2 className="border-b border-border p-4 text-base font-semibold">Com acesso ({admins.length})</h2>
        <ul className="divide-y divide-border">
          {admins.map((a) => (
            <li key={a.email} className="flex items-center justify-between gap-3 p-4 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {a.email} {a.email === me.email && <Badge tone="neutral">você</Badge>}
                </p>
                <p className="text-xs text-muted">Desde {fmt(a.created_at)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {a.email === me.email ? <Badge tone="neutral">{PERFIS[a.perfil].rotulo}</Badge> : <PerfilSelect email={a.email} perfil={a.perfil} />}
                {a.email !== me.email && admins.length > 1 && <RemoveUserButton email={a.email} />}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
