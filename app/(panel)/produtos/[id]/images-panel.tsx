"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ImageRow } from "@/lib/catalog/images";
import { prepareImageFile } from "@/lib/client/compress-image";
import { moveProductImage, removeProductImage, setMainProductImage, uploadProductImage, type ActionState } from "./media-actions";

export function ImagesPanel({ productId, images }: { productId: number; images: ImageRow[] }) {
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
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((img, i) => (
            <li key={img.id} className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-2">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.src} alt={img.alt || `Imagem ${i + 1}`} loading="lazy" className="aspect-square w-full rounded object-cover" />
                <span className="absolute left-1 top-1 rounded bg-card/90 px-1.5 text-xs font-medium text-foreground shadow-sm" aria-hidden>
                  {i + 1}
                </span>
              </div>
              {/* Linha própria para o rótulo e outra para os botões: no celular, 2 colunas não comportam tudo lado a lado. */}
              <div className="flex min-h-6 items-center">
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
              </div>
              <div className="grid grid-cols-3 gap-1">
                <Button type="button" variant="outline" className="min-h-10 px-0" disabled={busy || i === 0} aria-label="Mover para antes" onClick={() => run(() => moveProductImage(productId, Number(img.id), -1))}>
                  ←
                </Button>
                <Button type="button" variant="outline" className="min-h-10 px-0" disabled={busy || i === images.length - 1} aria-label="Mover para depois" onClick={() => run(() => moveProductImage(productId, Number(img.id), 1))}>
                  →
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="min-h-10 px-0"
                  disabled={busy}
                  aria-label="Remover imagem"
                  onClick={() => {
                    if (window.confirm("Remover esta imagem da Nuvemshop? Isso não pode ser desfeito.")) run(() => removeProductImage(productId, Number(img.id)));
                  }}
                >
                  ✕
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {message?.message && (
        <p role="status" className={`mt-3 text-sm ${message.ok ? "text-success" : "text-danger"}`}>
          {message.message}
        </p>
      )}
    </Card>
  );
}
