import { requireAdmin } from "@/lib/auth/admin";
import { PanelHeader } from "@/components/panel-header";
import { signOut } from "./actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16">
      <PanelHeader email={admin.email} signOut={signOut} />
      {children}
    </div>
  );
}
