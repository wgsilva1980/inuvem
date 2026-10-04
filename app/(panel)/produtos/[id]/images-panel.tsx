"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ImageRow } from "@/lib/catalog/images";
import { prepareImageFile } from "@/lib/client/compress-image";
import { addProductImage, moveProductImage, removeProductImage, setMainProductImage, uploadProductImage, type ActionState } from "./media-actions";
import { fieldClass } from "@/components/ui/field";

export function ImagesPanel({ productId, images }: { productId: number; images: ImageRow[] }) {
  const [addState, addAction, adding] = useActionState<ActionState | null, FormData>(addProductImage.bind(null, productId), null);
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<ActionState | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function run(task: () => Promise<ActionState>) {
    startTransition(async () => setMessage(await task()));
  }

  async function sendFiles(files: FileList | File[]) {
    setMessage({ message: "Preparando as imagens…" });
    startTransition(async () => {
      const results: string[] = [];
      let ok = true;
      for (const original of Array.from(files)) {
        try {
          const file = await prepareImageFile(original);
          const body = new FormData();
          body.set("file", file);
          const r = await uploadProductImage(productId, body);
          if (!r.ok) ok = false;
          results.push(`${original.name}: ${r.message ?? (r.ok ? "enviada" : "falhou")}`);
        } catch (err) {
          ok = false;
          results.push(`${original.name}: ${err instanceof Error ? err.message : "falhou"}`);
        }
      }
      setMessage({ ok, message: results.join(" · ") });
      if (fileInput.current) fileInput.current.value = "";
    });
  }

  return (
    <Card>
      <h2 className="text-base font-semibold">Imagens</h2>
      <p className="mt-1 text-sm text-muted">A primeira imagem é a principal. A ordem mostrada é a que a loja usa.</p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length > 0) void sendFiles(e.dataTransfer.files);
        }}
        className={`mt-3 flex flex-col items-center gap-2 rounded-md border-2 border-dashed p-5 text-center text-sm ${dragging ? "border-primary bg-primary/5" : "border-border"}`}
      >
        <p className="font-medium">Arraste as fotos aqui ou escolha arquivos</p>
        <p className="text-xs text-muted">JPEG, PNG, WEBP ou GIF. Fotos grandes são reduzidas automaticamente (até 4 MB por arquivo).</p>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="sr-only"
          id="upload-imagens"
          onChange={(e) => e.target.files && e.target.files.length > 0 && void sendFiles(e.target.files)}
        />
        <label htmlFor="upload-imagens" className={`cursor-pointer rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-border/40 ${busy ? "pointer-events-none opacity-50" : ""}`}>
          {busy ? "Enviando…" : "Escolher arquivos"}
        </label>
      </div>

      {images.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Este produto não tem imagens.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {images.map((img, i) => (
            <li key={img.id} className="flex flex-col gap-2 rounded-md border border-border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt={img.alt || `Imagem ${i + 1}`} loading="lazy" className="aspect-square w-full rounded object-cover" />
              <div className="flex items-center justify-between gap-1">
                {i === 0 ? (
                  <span className="text-xs font-medium text-primary">★ Principal</span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => setMainProductImage(productId, Number(img.id)))}
                    className="text-xs text-muted underline hover:text-foreground disabled:opacity-50"
                  >
                    Tornar principal
                  </button>
                )}
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
        <span className="text-sm text-muted sm:pt-2">ou por URL pública:</span>
        <div className="flex-1">
          <input name="src" type="url" required placeholder="https://exemplo.com/foto.jpg" aria-label="URL da nova imagem" className={fieldClass} />
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
