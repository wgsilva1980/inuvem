"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface DetectorDeBarras {
  detect(imagem: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
type DetectorCtor = { new (opcoes?: { formats?: string[] }): DetectorDeBarras };

const FORMATOS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];
const detectorDoNavegador = (): DetectorCtor | null => (typeof window !== "undefined" ? ((window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector ?? null) : null);

/** O navegador consegue ler código de barras pela câmera? (Chrome no Android sim; Safari no iPhone ainda não.) */
export const cameraSuportada = (): boolean => detectorDoNavegador() !== null && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/**
 * Abre a câmera traseira e chama `aoLer` a cada código novo (o mesmo código só é repetido depois de 2 s, para uma leitura não contar duas vezes).
 * A imagem fica só no aparelho: nada é gravado nem enviado.
 */
export function LeitorCamera({ aoLer, aoFechar }: { aoLer: (codigo: string) => void; aoFechar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const aoLerRef = useRef(aoLer);
  aoLerRef.current = aoLer;

  useEffect(() => {
    const Detector = detectorDoNavegador();
    if (!Detector) {
      setErro("Este navegador não lê código de barras pela câmera. Use o campo de texto (ou um leitor de código de barras).");
      return;
    }
    let parar = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const detector = new Detector({ formats: FORMATOS });
    const ultimo = { codigo: "", em: 0 };

    async function ciclo() {
      if (parar) return;
      const el = video.current;
      if (el && el.readyState >= 2) {
        try {
          const achados = await detector.detect(el);
          const codigo = achados[0]?.rawValue?.trim();
          if (codigo && (codigo !== ultimo.codigo || Date.now() - ultimo.em > 2000)) {
            ultimo.codigo = codigo;
            ultimo.em = Date.now();
            aoLerRef.current(codigo);
          }
        } catch {
          /* quadro sem código: tenta de novo */
        }
      }
      timer = setTimeout(ciclo, 250);
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((s) => {
        if (parar) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => undefined);
        }
        void ciclo();
      })
      .catch(() => setErro("Não consegui abrir a câmera. Libere a permissão da câmera para este site no navegador e tente de novo."));

    return () => {
      parar = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-strong bg-card p-2">
      {erro ? (
        <p role="alert" className="p-2 text-sm text-danger">
          {erro}
        </p>
      ) : (
        <video ref={video} muted playsInline className="aspect-[4/3] w-full rounded-md bg-black object-cover" aria-label="Câmera para ler o código de barras" />
      )}
      <Button type="button" variant="outline" onClick={aoFechar}>
        Fechar câmera
      </Button>
    </div>
  );
}
