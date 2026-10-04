"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface RegisterResponse {
  error?: string;
  created?: string[];
  existing?: string[];
  otherUrl?: string[];
  failed?: Array<{ event: string; message: string }>;
}

export function WebhookButton({ disabled }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function register() {
    setBusy(true);
    setFailed(false);
    setMessage("Registrando…");
    try {
      const res = await fetch("/api/nuvemshop/register-webhooks", { method: "POST" });
      const data = (await res.json()) as RegisterResponse;
      if (!res.ok || data.error) throw new Error(data.error ?? "Falha ao registrar os webhooks.");
      const parts = [`${data.created?.length ?? 0} criados`, `${data.existing?.length ?? 0} já existiam`];
      if (data.otherUrl?.length) parts.push(`${data.otherUrl.length} já tinham outra URL`);
      if (data.failed?.length) {
        setFailed(true);
        parts.push(`${data.failed.length} falharam: ${data.failed.map((f) => `${f.event} (${f.message})`).join("; ")}`);
      }
      setMessage(parts.join(" · "));
    } catch (err) {
      setFailed(true);
      setMessage(err instanceof Error ? err.message : "Falha ao registrar os webhooks.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button type="button" variant="outline" onClick={register} disabled={disabled || busy}>
          {busy ? "Registrando…" : "Registrar webhooks"}
        </Button>
      </div>
      {message && (
        <p role={failed ? "alert" : "status"} className={`text-sm ${failed ? "text-danger" : "text-muted"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
