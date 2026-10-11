import { requireUsuario } from "@/lib/auth/admin";
import { PanelHeader } from "@/components/panel-header";
import { signOut } from "./actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireUsuario();
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16">
      <PanelHeader email={admin.email} perfil={admin.perfil} signOut={signOut} />
      {children}
    </div>
  );
}
