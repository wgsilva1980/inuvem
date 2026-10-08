"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ImageRow } from "@/lib/catalog/images";
import { prepareImageFile } from "@/lib/client/compress-image";
import { fieldClass } from "@/components/ui/field";
import { ENQUADRAMENTO_LABEL, TAMANHO, TIPO_LABEL, type Enquadramento, type Tipo } from "@/lib/images/standard";
import type { Recorte } from "@/lib/images/recorte";
import { CropEditor } from "./crop-editor";
import { moveProductImage, previewProductImage, removeProductImage, setMainProductImage, uploadProductImage, type ActionState, type PreviewState } from "./media-actions";

interface Staged {
  id: string;
  file: File;
  tipo: "auto" | Tipo;
  enquadramento: "auto" | Enquadramento;
  padronizar: boolean;
  /** Enquadramento manual: retângulo escolhido no editor (null = ainda não mexeu: a foto preenche o quadro). */
  recorte: Recorte | null;
  carregando: boolean;
  enviando: boolean;
  preview?: PreviewState;
  originalUrl: string;
  erro?: string;
}

const kb = (n: number) => `${Math.round(n / 1024)} KB`;

const formDe = (s: Pick<Staged, "file" | "tipo" | "enquadramento" | "padronizar" | "recorte">) => {
  const body = new FormData();
  body.set("file", s.file);
  body.set("tipo", s.tipo);
  body.set("enquadramento", s.enquadramento);
  body.set("padronizar", s.padronizar ? "1" : "0");
  if (s.enquadramento === "manual" && s.recorte) body.set("recorte", JSON.stringify(s.recorte));
  return body;
};

export function ImagesPanel({ productId, images }: { productId: number; images: ImageRow[] }) {
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<ActionState | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function run(task: () => Promise<ActionState>) {
    startTransition(async () => setMessage(await task()));
  }

  const [staged, setStaged] = useState<Staged[]>([]);
  const [enviandoTudo, setEnviandoTudo] = useState(false);

  const patch = (id: string, p: Partial<Staged>) => setStaged((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)));

  // Só a resposta da última pedida vale (arrastar no editor dispara várias prévias seguidas).
  const sequencia = useRef(new Map<string, number>());
  const adiar = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  /** `silenciosa`: atualiza a prévia sem trocar a imagem por "Preparando…" (o editor manual precisa continuar na tela). */
  async function carregarPrevia(item: Staged, silenciosa = false) {
    const n = (sequencia.current.get(item.id) ?? 0) + 1;
    sequencia.current.set(item.id, n);
    patch(item.id, silenciosa ? { erro: undefined } : { carregando: true, erro: undefined });
    try {
      const preview = await previewProductImage(formDe(item));
      if (sequencia.current.get(item.id) !== n) return;
      patch(item.id, { carregando: false, preview, erro: preview.ok ? undefined : preview.message });
    } catch {
      if (sequencia.current.get(item.id) !== n) return;
      patch(item.id, { carregando: false, erro: "Não foi possível gerar a prévia. Tente de novo." });
    }
  }

  /** Move/zoom no editor manual: guarda o recorte na hora e atualiza a prévia (tamanho, miniatura) depois de uma pausa. */
  function recortar(item: Staged, recorte: Recorte) {
    patch(item.id, { recorte });
    clearTimeout(adiar.current.get(item.id));
    adiar.current.set(
      item.id,
      setTimeout(() => void carregarPrevia({ ...item, recorte }, true), 500),
    );
  }

  async function addFiles(files: FileList | File[]) {
    setMessage(null);
    for (const original of Array.from(files)) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const file = await prepareImageFile(original);
        const item: Staged = { id, file, tipo: "auto", enquadramento: "auto", padronizar: true, recorte: null, carregando: true, enviando: false, originalUrl: URL.createObjectURL(file) };
        setStaged((list) => [...list, item]);
        void carregarPrevia(item);
      } catch (err) {
        setMessage({ message: `${original.name}: ${err instanceof Error ? err.message : "não foi possível ler a imagem."}` });
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  function descartar(id: string) {
    clearTimeout(adiar.current.get(id));
    sequencia.current.set(id, (sequencia.current.get(id) ?? 0) + 1); // ignora prévia em andamento
    setStaged((list) => {
      const item = list.find((x) => x.id === id);
      if (item) URL.revokeObjectURL(item.originalUrl);
      return list.filter((x) => x.id !== id);
    });
  }

  /** Muda uma opção e refaz a prévia com ela. */
  function mudar(item: Staged, p: Partial<Pick<Staged, "tipo" | "enquadramento" | "padronizar">>) {
    clearTimeout(adiar.current.get(item.id));
    // Mudar o tipo muda a proporção do quadro: o recorte antigo não vale mais.
    const novo = { ...item, ...p, ...(p.tipo !== undefined || p.enquadramento !== undefined ? { recorte: null } : {}) };
    patch(item.id, { ...p, ...(p.tipo !== undefined || p.enquadramento !== undefined ? { recorte: null } : {}) });
    if (novo.padronizar) void carregarPrevia(novo);
  }

  async function enviar(item: Staged): Promise<boolean> {
    patch(item.id, { enviando: true, erro: undefined });
    try {
      const r = await uploadProductImage(productId, formDe(item));
      if (r.ok) {
        descartar(item.id);
        return true;
      }
      patch(item.id, { enviando: false, erro: r.message ?? "Falhou." });
    } catch {
      patch(item.id, { enviando: false, erro: "Falhou. Tente de novo." });
    }
    return false;
  }

  async function enviarTodas() {
    setEnviandoTudo(true);
    let ok = 0;
    for (const item of staged.filter((x) => !x.carregando && (x.preview?.ok || !x.padronizar))) if (await enviar(item)) ok++;
    setEnviandoTudo(false);
    setMessage({ ok: ok > 0, message: ok > 0 ? `${ok} ${ok === 1 ? "imagem enviada" : "imagens enviadas"} à Nuvemshop.` : "Nenhuma imagem foi enviada." });
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
          if (e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
        }}
        className={`mt-3 flex flex-col items-center gap-2 rounded-md border-2 border-dashed p-5 text-center text-sm ${dragging ? "border-primary bg-primary/5" : "border-border"}`}
      >
        <p className="font-medium">Arraste as fotos aqui ou escolha arquivos</p>
        <p className="text-xs text-muted">JPEG, PNG, WEBP ou GIF. As fotos são padronizadas antes de enviar: 1024 × 1024 (peça solta) ou 820 × 1024 (modelo), em JPEG. Você confere a prévia antes.</p>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="sr-only"
          id="upload-imagens"
          onChange={(e) => e.target.files && e.target.files.length > 0 && void addFiles(e.target.files)}
        />
        <label htmlFor="upload-imagens" className={`cursor-pointer rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-border/40 ${enviandoTudo ? "pointer-events-none opacity-50" : ""}`}>
          Escolher arquivos
        </label>
      </div>

      {staged.length > 0 && (
        <div className="mt-3 flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Para enviar ({staged.length})</h3>
          <ul className="flex flex-col gap-3">
            {staged.map((it) => {
              const p = it.preview;
              const pronto = !it.carregando && (p?.ok || !it.padronizar);
              return (
                <li key={it.id} className="flex flex-col gap-3 rounded-md border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium">{it.file.name}</p>
                    <button type="button" disabled={it.enviando || enviandoTudo} onClick={() => descartar(it.id)} className="shrink-0 text-sm text-danger underline disabled:opacity-50">
                      Descartar
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_9rem]">
                    <div className="flex min-h-40 items-center justify-center rounded bg-border/30 p-2">
                      {it.carregando ? (
                        <p className="text-sm text-muted">Preparando a prévia…</p>
                      ) : it.padronizar && it.enquadramento === "manual" && p?.ok && p.tipo && !p.semPadronizar ? (
                        <CropEditor
                          src={it.originalUrl}
                          quadro={TAMANHO[p.tipo]}
                          fundo={p.fundo ?? "#F5F1EC"}
                          recorte={it.recorte}
                          onChange={(r) => recortar(it, r)}
                          disabled={it.enviando || enviandoTudo}
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.padronizar && p?.dataUrl ? p.dataUrl : it.originalUrl} alt="Prévia da imagem" className="max-h-80 w-auto max-w-full rounded object-contain" />
                      )}
                    </div>
                    {it.padronizar && p?.dataUrl && !it.carregando && (
                      <div className="flex flex-col items-start gap-1">
                        <p className="text-xs text-muted">Na vitrine (miniatura quadrada)</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.dataUrl} alt="Como a miniatura quadrada da vitrine mostra a foto" className="aspect-square w-36 rounded border border-border object-cover" />
                      </div>
                    )}
                  </div>

                  {it.padronizar && p?.ok && !p.semPadronizar && p.largura && p.altura && p.bytes && p.original && (
                    <p className="text-sm text-muted">
                      {p.tipo ? TIPO_LABEL[p.tipo] : ""} · {p.enquadramento ? ENQUADRAMENTO_LABEL[p.enquadramento].split(" ")[0] : ""} · {p.largura}×{p.altura} · {kb(p.bytes)} (original {p.original.largura}×{p.original.altura}, {kb(p.original.bytes)})
                      {p.fundoUniforme ? ` · fundo da foto ${p.fundo}` : ` · bordas ${p.fundo}`}
                    </p>
                  )}
                  {p?.semPadronizar && p.message && <p className="text-sm text-muted">{p.message}</p>}
                  {(p?.avisos ?? []).map((a) => (
                    <p key={a} className="text-sm text-warning">
                      ⚠ {a}
                    </p>
                  ))}
                  {it.erro && (
                    <p role="alert" className="text-sm text-danger">
                      {it.erro}
                    </p>
                  )}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted">Tipo da foto</span>
                      <select value={it.tipo} disabled={!it.padronizar || it.enviando || enviandoTudo} onChange={(e) => mudar(it, { tipo: e.target.value as Staged["tipo"] })} className={fieldClass}>
                        <option value="auto">Automático{p?.tipo && it.tipo === "auto" ? ` (${TIPO_LABEL[p.tipo]})` : ""}</option>
                        <option value="peca">{TIPO_LABEL.peca}</option>
                        <option value="modelo">{TIPO_LABEL.modelo}</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted">Enquadramento</span>
                      <select value={it.enquadramento} disabled={!it.padronizar || it.enviando || enviandoTudo} onChange={(e) => mudar(it, { enquadramento: e.target.value as Staged["enquadramento"] })} className={fieldClass}>
                        <option value="auto">Automático{p?.enquadramento && it.enquadramento === "auto" ? ` (${ENQUADRAMENTO_LABEL[p.enquadramento].split(" ")[0]})` : ""}</option>
                        <option value="ajustar">{ENQUADRAMENTO_LABEL.ajustar}</option>
                        <option value="cortar">{ENQUADRAMENTO_LABEL.cortar}</option>
                        <option value="manual">{ENQUADRAMENTO_LABEL.manual}</option>
                      </select>
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!it.padronizar} disabled={it.enviando || enviandoTudo} onChange={(e) => mudar(it, { padronizar: !e.target.checked })} />
                    <span>Enviar como está (sem padronizar)</span>
                  </label>
                  <div>
                    <Button type="button" variant="outline" disabled={!pronto || it.enviando || enviandoTudo} onClick={() => void enviar(it)}>
                      {it.enviando ? "Enviando…" : "Enviar esta"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={enviandoTudo || staged.some((x) => x.carregando) || staged.every((x) => !(x.preview?.ok || !x.padronizar))} onClick={() => void enviarTodas()}>
              {enviandoTudo ? "Enviando…" : staged.length === 1 ? "Enviar para a loja" : `Enviar as ${staged.length} fotos para a loja`}
            </Button>
          </div>
        </div>
      )}

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
