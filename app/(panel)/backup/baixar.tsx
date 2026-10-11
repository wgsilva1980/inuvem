"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function Baixar() {
  const router = useRouter();
  const [clientes, setClientes] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function baixar() {
    setGerando(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/backup${clientes ? "?clientes=1" : ""}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Não foi possível gerar o backup.");
      }
      const blob = await res.blob();
      const nome = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "backup-inuvem.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg({ ok: true, texto: `Backup gerado (${(blob.size / 1_048_576).toFixed(1)} MB). Guarde uma cópia fora do computador.` });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, texto: e instanceof Error ? e.message : "Falha ao gerar o backup." });
    } finally {
      setGerando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={clientes} onChange={(e) => setClientes(e.target.checked)} className="mt-1" />
        <span>
          Incluir os <strong>clientes</strong> (nome, e-mail, telefone, cidade e total gasto). <span className="text-muted">São dados pessoais: guarde o arquivo em local protegido, não compartilhe e apague quando não precisar mais. O pedido fica registrado no Histórico.</span>
        </span>
      </label>
      <div>
        <Button type="button" onClick={baixar} disabled={gerando} className="min-h-11">
          {gerando ? "Gerando…" : "Gerar e baixar o backup"}
        </Button>
      </div>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-success" : "text-danger"}>
          {msg.texto}
        </p>
      )}
    </div>
  );
}
