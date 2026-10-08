"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import type { EnquadramentoFoto } from "@/lib/catalog/drafts-shared";
import type { Recorte } from "@/lib/images/recorte";
import { ENQUADRAMENTO_LABEL, TAMANHO, TIPO_LABEL } from "@/lib/images/standard";
import { CropEditor } from "../[id]/crop-editor";
import { previewProductImage, type PreviewState } from "../[id]/media-actions";

const kb = (n: number) => `${Math.round(n / 1024)} KB`;

/**
 * Escolhe como uma foto nova será enquadrada antes de subir para a loja: tipo (peça 1:1 ou modelo 4:5), enquadramento (automático, ajustar,
 * cortar ou manual com mover e zoom) e a prévia do resultado. É o mesmo padrão e o mesmo editor da tela do produto.
 */
export function EnquadrarFoto({
  src,
  obterArquivo,
  valor,
  onChange,
  onPrevia,
  onConcluir,
}: {
  /** Endereço da foto para mostrar no editor manual. */
  src: string;
  /** Arquivo usado para gerar a prévia no servidor. */
  obterArquivo: () => Promise<File>;
  valor: EnquadramentoFoto;
  onChange: (v: EnquadramentoFoto) => void;
  /** Recebe a prévia (JPEG já enquadrado) para mostrar na miniatura da foto. */
  onPrevia: (dataUrl: string | null) => void;
  onConcluir: () => void;
}) {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const sequencia = useRef(0);
  const adiar = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const arquivo = useRef<Promise<File> | null>(null);

  async function carregar(v: EnquadramentoFoto, silenciosa: boolean) {
    const n = ++sequencia.current;
    if (!silenciosa) setCarregando(true);
    setErro(null);
    try {
      arquivo.current ??= obterArquivo();
      const file = await arquivo.current;
      const body = new FormData();
      body.set("file", file);
      body.set("tipo", v.tipo);
      body.set("enquadramento", v.enquadramento);
      body.set("padronizar", "1");
      if (v.enquadramento === "manual" && v.recorte) body.set("recorte", JSON.stringify(v.recorte));
      const p = await previewProductImage(body);
      if (sequencia.current !== n) return;
      setPreview(p);
      setErro(p.ok ? null : (p.message ?? "Não foi possível gerar a prévia."));
      if (p.ok && p.dataUrl) onPrevia(p.dataUrl);
    } catch {
      if (sequencia.current !== n) return;
      arquivo.current = null;
      setErro("Não foi possível gerar a prévia. Tente de novo.");
    } finally {
      if (sequencia.current === n) setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar(valor, false);
    return () => {
      clearTimeout(adiar.current);
      sequencia.current++;
    };
    // só ao abrir: as mudanças seguintes chamam `carregar` direto
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Mudar tipo ou enquadramento muda a proporção do quadro: o recorte antigo não vale mais. */
  function mudar(p: Partial<Pick<EnquadramentoFoto, "tipo" | "enquadramento">>) {
    clearTimeout(adiar.current);
    const novo: EnquadramentoFoto = { ...valor, ...p, recorte: null };
    onChange(novo);
    void carregar(novo, false);
  }

  function recortar(recorte: Recorte) {
    const novo: EnquadramentoFoto = { ...valor, recorte };
    onChange(novo);
    clearTimeout(adiar.current);
    adiar.current = setTimeout(() => void carregar(novo, true), 500);
  }

  const manual = valor.enquadramento === "manual" && preview?.ok && preview.tipo && !preview.semPadronizar;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-primary p-3" role="region" aria-label="Enquadramento da foto">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_9rem]">
        <div className="flex min-h-40 items-center justify-center rounded bg-border/30 p-2">
          {carregando && !preview ? (
            <p className="text-sm text-muted">Preparando a prévia…</p>
          ) : manual ? (
            <CropEditor src={src} quadro={TAMANHO[preview!.tipo!]} fundo={preview!.fundo ?? "#F5F1EC"} recorte={valor.recorte} onChange={recortar} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview?.ok && preview.dataUrl ? preview.dataUrl : src} alt="Prévia da foto enquadrada" className="max-h-80 w-auto max-w-full rounded object-contain" />
          )}
        </div>
        {preview?.ok && preview.dataUrl && (
          <div className="flex flex-col items-start gap-1">
            <p className="text-xs text-muted">Na vitrine (miniatura quadrada)</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.dataUrl} alt="Como a miniatura quadrada da vitrine mostra a foto" className="aspect-square w-36 rounded border border-border object-cover" />
          </div>
        )}
      </div>

      {preview?.ok && preview.largura && preview.altura && preview.bytes && preview.original && (
        <p className="text-sm text-muted">
          {preview.tipo ? TIPO_LABEL[preview.tipo] : ""} · {preview.enquadramento ? ENQUADRAMENTO_LABEL[preview.enquadramento].split(" ")[0] : ""} · {preview.largura}×{preview.altura} · {kb(preview.bytes)} (original {preview.original.largura}×{preview.original.altura})
          {carregando ? " · atualizando…" : ""}
        </p>
      )}
      {(preview?.avisos ?? []).map((a) => (
        <p key={a} className="text-sm text-warning">
          ⚠ {a}
        </p>
      ))}
      {erro && (
        <p role="alert" className="text-sm text-danger">
          {erro}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Tipo da foto</span>
          <select value={valor.tipo} onChange={(e) => mudar({ tipo: e.target.value as EnquadramentoFoto["tipo"] })} className={fieldClass}>
            <option value="auto">Automático{preview?.tipo && valor.tipo === "auto" ? ` (${TIPO_LABEL[preview.tipo]})` : ""}</option>
            <option value="peca">{TIPO_LABEL.peca}</option>
            <option value="modelo">{TIPO_LABEL.modelo}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Enquadramento</span>
          <select value={valor.enquadramento} onChange={(e) => mudar({ enquadramento: e.target.value as EnquadramentoFoto["enquadramento"] })} className={fieldClass}>
            <option value="auto">Automático{preview?.enquadramento && valor.enquadramento === "auto" ? ` (${ENQUADRAMENTO_LABEL[preview.enquadramento].split(" ")[0]})` : ""}</option>
            <option value="ajustar">{ENQUADRAMENTO_LABEL.ajustar}</option>
            <option value="cortar">{ENQUADRAMENTO_LABEL.cortar}</option>
            <option value="manual">{ENQUADRAMENTO_LABEL.manual}</option>
          </select>
        </label>
      </div>
      <div>
        <Button type="button" onClick={onConcluir}>
          Concluir
        </Button>
      </div>
    </div>
  );
}
