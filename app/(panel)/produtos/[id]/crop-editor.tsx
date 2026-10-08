"use client";

import { useEffect, useRef, useState } from "react";
import { aplicarZoom, alturaDoRecorte, limitarRecorte, limitesDeLargura, recorteInicial, type Recorte } from "@/lib/images/recorte";

/**
 * Enquadramento manual: o quadro tem a proporção final (1:1 ou 4:5) e mostra exatamente o que será enviado.
 * Arraste a foto para mover; use o controle de zoom, a roda do mouse ou os botões +/−. Onde a foto não chega, aparece a cor de fundo.
 */
export function CropEditor({
  src,
  quadro,
  fundo,
  recorte,
  onChange,
  disabled,
}: {
  src: string;
  /** Tamanho final da foto (px). Só a proporção importa aqui. */
  quadro: { largura: number; altura: number };
  fundo: string;
  recorte: Recorte | null;
  onChange: (r: Recorte) => void;
  disabled?: boolean;
}) {
  const quadroAspecto = quadro.largura / quadro.altura;
  const [foto, setFoto] = useState<{ w: number; h: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const arrasto = useRef<{ x: number; y: number; r: Recorte } | null>(null);
  const fotoAspecto = foto ? foto.w / foto.h : null;

  // Recorte inicial (e sempre que a proporção do quadro muda): a foto preenche o quadro.
  const r = fotoAspecto ? limitarRecorte(recorte ?? recorteInicial(fotoAspecto, quadroAspecto), fotoAspecto, quadroAspecto) : null;
  useEffect(() => {
    if (fotoAspecto && !recorte) onChange(recorteInicial(fotoAspecto, quadroAspecto));
  }, [fotoAspecto, quadroAspecto, recorte, onChange]);

  // A roda do mouse precisa de um ouvinte nativo (o do React é passivo e não deixa impedir a rolagem da página).
  const ref = useRef({ r, fotoAspecto, quadroAspecto, onChange, disabled });
  ref.current = { r, fotoAspecto, quadroAspecto, onChange, disabled };
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const c = ref.current;
      if (c.disabled || !c.r || !c.fotoAspecto) return;
      e.preventDefault();
      const box = el.getBoundingClientRect();
      const fator = Math.exp(e.deltaY * 0.0015);
      c.onChange(aplicarZoom(c.r, c.r.w * fator, (e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height, c.fotoAspecto, c.quadroAspecto));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  if (!fotoAspecto || !r) {
    return (
      <div className="flex flex-col items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="sr-only" onLoad={(e) => setFoto({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
        <p className="text-sm text-muted">Carregando a foto…</p>
      </div>
    );
  }

  const lim = limitesDeLargura(fotoAspecto, quadroAspecto);
  const h = alturaDoRecorte(r.w, fotoAspecto, quadroAspecto);
  // zoom 0 = foto inteira (com margem); 1 = zoom máximo. Escala logarítmica para o controle ficar uniforme.
  const zoom = Math.log(lim.inteira / r.w) / Math.log(lim.inteira / lim.minima);
  const setZoom = (z: number) => onChange(aplicarZoom(r, lim.inteira * Math.pow(lim.minima / lim.inteira, z), 0.5, 0.5, fotoAspecto, quadroAspecto));
  const passo = (d: number) => setZoom(Math.min(1, Math.max(0, zoom + d)));

  function aoPressionar(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    arrasto.current = { x: e.clientX, y: e.clientY, r: r! };
  }
  function aoMover(e: React.PointerEvent<HTMLDivElement>) {
    const a = arrasto.current;
    if (!a || !frame.current) return;
    const box = frame.current.getBoundingClientRect();
    const ah = alturaDoRecorte(a.r.w, fotoAspecto!, quadroAspecto);
    onChange(limitarRecorte({ w: a.r.w, x: a.r.x - ((e.clientX - a.x) / box.width) * a.r.w, y: a.r.y - ((e.clientY - a.y) / box.height) * ah }, fotoAspecto!, quadroAspecto));
  }
  function aoSoltar() {
    arrasto.current = null;
  }
  function aoTeclar(e: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const d = 0.03 * r!.w;
    const mover = (dx: number, dy: number) => {
      e.preventDefault();
      onChange(limitarRecorte({ ...r!, x: r!.x + dx, y: r!.y + dy * (h / r!.w) }, fotoAspecto!, quadroAspecto));
    };
    if (e.key === "ArrowLeft") mover(-d, 0);
    else if (e.key === "ArrowRight") mover(d, 0);
    else if (e.key === "ArrowUp") mover(0, -d);
    else if (e.key === "ArrowDown") mover(0, d);
    else if (e.key === "+" || e.key === "=") (e.preventDefault(), passo(0.05));
    else if (e.key === "-") (e.preventDefault(), passo(-0.05));
  }

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div
        ref={frame}
        role="application"
        aria-label="Enquadramento manual da foto. Arraste para mover; use as setas para mover e + ou − para o zoom."
        tabIndex={0}
        onPointerDown={aoPressionar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
        onKeyDown={aoTeclar}
        className={`relative w-full max-w-80 touch-none select-none overflow-hidden rounded border border-border-strong outline-offset-2 focus-visible:outline-2 ${disabled ? "opacity-60" : "cursor-grab active:cursor-grabbing"}`}
        style={{ aspectRatio: `${quadro.largura} / ${quadro.altura}`, backgroundColor: fundo }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Foto sendo enquadrada"
          draggable={false}
          className="pointer-events-none absolute max-w-none"
          style={{
            width: `${100 / r.w}%`,
            left: `${(-r.x / r.w) * 100}%`,
            top: `${((-r.y * quadroAspecto) / (r.w * fotoAspecto)) * 100}%`,
          }}
        />
        {/* linhas de terço, só para ajudar a compor */}
        <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: "linear-gradient(to right, transparent 33%, #fff 33%, #fff calc(33% + 1px), transparent calc(33% + 1px), transparent 66%, #fff 66%, #fff calc(66% + 1px), transparent calc(66% + 1px)), linear-gradient(to bottom, transparent 33%, #fff 33%, #fff calc(33% + 1px), transparent calc(33% + 1px), transparent 66%, #fff 66%, #fff calc(66% + 1px), transparent calc(66% + 1px))" }} />
      </div>
      <div className="flex w-full max-w-80 items-center gap-2">
        <button type="button" disabled={disabled} onClick={() => passo(-0.1)} aria-label="Diminuir o zoom" className="min-h-9 min-w-9 rounded-md border border-border text-lg leading-none hover:bg-border/40 disabled:opacity-50">
          −
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={Number.isFinite(zoom) ? zoom : 0}
          disabled={disabled}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label="Zoom"
          className="min-w-0 flex-1"
        />
        <button type="button" disabled={disabled} onClick={() => passo(0.1)} aria-label="Aumentar o zoom" className="min-h-9 min-w-9 rounded-md border border-border text-lg leading-none hover:bg-border/40 disabled:opacity-50">
          +
        </button>
        <button type="button" disabled={disabled} onClick={() => onChange(recorteInicial(fotoAspecto, quadroAspecto))} className="min-h-9 rounded-md border border-border px-2 text-sm hover:bg-border/40 disabled:opacity-50">
          Centralizar
        </button>
      </div>
      <p className="text-xs text-muted">Arraste a foto para mover · roda do mouse, controle ou +/− para o zoom</p>
    </div>
  );
}
