"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ImageRow } from "@/lib/catalog/images";
import { addProductImage, moveProductImage, removeProductImage, type ActionState } from "./media-actions";

const field = "min-h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";

export function ImagesPanel({ productId, images }: { productId: number; images: ImageRow[] }) {
  const [addState, addAction, adding] = useActionState<ActionState | null, FormData>(addProductImage.bind(null, productId), null);
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<ActionState | null>(null);

  function run(task: () => Promise<ActionState>) {
    startTransition(async () => setMessage(await task()));
  }

  return (
    <Card>
      <h2 className="text-base font-semibold">Imagens</h2>
      <p className="mt-1 text-sm text-muted">
        A Nuvemshop baixa a imagem a partir de uma URL pública (https). A ordem mostrada é a que a loja usa.
      </p>

      {images.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Este produto não tem imagens.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {images.map((img, i) => (
            <li key={img.id} className="flex flex-col gap-2 rounded-md border border-border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt={img.alt || `Imagem ${i + 1}`} loading="lazy" className="aspect-square w-full rounded object-cover" />
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs text-muted">#{i + 1}</span>
                <div className="flex gap-1">
                  <Button type="button" variant="outline" className="min-h-8 px-2 py-1" disabled={busy || i === 0} aria-label="Mover para cima" onClick={() => run(() => moveProductImage(productId, Number(img.id), -1))}>
                    ←
                  </Button>
                  <Button type="button" variant="outline" className="min-h-8 px-2 py-1" disabled={busy || i === images.length - 1} aria-label="Mover para baixo" onClick={() => run(() => moveProductImage(productId, Number(img.id), 1))}>
                    →
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    className="min-h-8 px-2 py-1"
                    disabled={busy}
                    aria-label="Remover imagem"
                    onClick={() => {
                      if (window.confirm("Remover esta imagem da Nuvemshop? Isso não pode ser desfeito.")) run(() => removeProductImage(productId, Number(img.id)));
                    }}
                  >
                    ✕
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form action={addAction} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1">
          <input name="src" type="url" required placeholder="https://exemplo.com/foto.jpg" aria-label="URL da nova imagem" className={field} />
          {addState?.fieldErrors?.src && <p className="mt-1 text-sm text-danger">{addState.fieldErrors.src}</p>}
        </div>
        <Button type="submit" disabled={adding || busy}>
          {adding ? "Enviando…" : "Adicionar imagem"}
        </Button>
      </form>

      {(message?.message || (addState?.message && !addState.fieldErrors)) && (
        <p role="status" className={`mt-3 text-sm ${(message ?? addState)?.ok ? "text-success" : "text-danger"}`}>
          {message?.message ?? addState?.message}
        </p>
      )}
    </Card>
  );
}
