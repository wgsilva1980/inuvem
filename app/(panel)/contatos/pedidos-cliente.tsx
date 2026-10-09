"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/contacts/format";
import { carregarPedidos, type PedidoLinha } from "./pedidos-actions";

/** Mostra os últimos pedidos do cliente na loja, buscados só quando se pede. */
export function PedidosCliente({ contactId }: { contactId: number }) {
  const [pending, start] = useTransition();
  const [pedidos, setPedidos] = useState<PedidoLinha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function carregar() {
    setErro(null);
    start(async () => {
      const r = await carregarPedidos(contactId);
      if (r.ok) setPedidos(r.pedidos);
      else setErro(r.message);
    });
  }

  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      {pedidos === null && (
        <div>
          <Button type="button" variant="outline" disabled={pending} onClick={carregar}>
            {pending ? "Buscando…" : "Ver pedidos na loja"}
          </Button>
        </div>
      )}
      {erro && (
        <p role="alert" className="text-sm text-danger">
          {erro}
        </p>
      )}
      {pedidos !== null &&
        (pedidos.length === 0 ? (
          <p className="text-sm text-muted">Nenhum pedido encontrado para este cliente (a busca é feita pelo e-mail).</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {pedidos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-medium">#{p.numero ?? p.id}</span>
                <span className="text-muted">{p.data ? new Date(p.data).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : ""}</span>
                <span>{[p.status, p.pagamento, p.envio].filter(Boolean).join(" · ")}</span>
                <span className="text-muted">{p.itens} item(ns)</span>
                <span className="font-medium">{formatBRL(p.total)}</span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
