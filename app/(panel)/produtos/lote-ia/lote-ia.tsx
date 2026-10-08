"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldClass } from "@/components/ui/field";
import { MAX_FOTOS_IA, MAX_FOTOS_LOTE, rascunhoParaForm, type RascunhoIA } from "@/lib/catalog/ai-draft-shared";
import type { FotoSalva } from "@/lib/catalog/drafts-shared";
import { miniaturaParaAnalise, prepareImageFile } from "@/lib/client/compress-image";
import { estimarCustoUsd } from "@/lib/images/custo";
import { definirFotosRascunho, descartarRascunhoAction, salvarRascunhoCampos } from "../novo/rascunhos-actions";

interface FotoLote {
  id: string;
  nome: string;
  file: File;
  url: string;
  /** 1024 px: vai para a análise da peça. */
  mini: Blob;
  /** 512 px: vai para o agrupamento. */
  pequena: Blob;
}

type Estado = "aguardando" | "preparando" | "pronto" | "erro";
interface Grupo {
  id: string;
  rotulo: string;
  notas: string;
  fotoIds: string[];
  estado: Estado;
  passo?: string;
  rascunhoId?: number;
  mensagem?: string;
  avisos?: string[];
}

const novoId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const ROTULO_ESTADO: Record<Estado, string> = { aguardando: "Aguardando", preparando: "Preparando…", pronto: "Rascunho pronto", erro: "Com problema" };

/**
 * Cadastro em lote: fotos de várias peças -> grupos por peça (IA ou à mão) -> um rascunho por grupo, já analisado pela IA e com as fotos
 * guardadas. Tudo roda em sequência, uma peça por vez; o que já ficou pronto não se perde se a página fechar.
 */
export function LoteIa() {
  const [fotos, setFotos] = useState<FotoLote[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [agrupando, setAgrupando] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const [custo, setCusto] = useState(0);
  const [arrastando, setArrastando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const foto = (id: string) => fotos.find((f) => f.id === id);
  const emGrupo = new Set(grupos.flatMap((g) => g.fotoIds));
  const soltas = fotos.filter((f) => !emGrupo.has(f.id));
  const editavel = (g: Grupo) => g.estado === "aguardando" || g.estado === "erro";
  const pendentes = grupos.filter(editavel);
  const ocupado = agrupando || preparando;

  const patchGrupo = (id: string, p: Partial<Grupo>) => setGrupos((lista) => lista.map((g) => (g.id === id ? { ...g, ...p } : g)));

  async function adicionar(arquivos: FileList | File[]) {
    setErro(null);
    for (const original of Array.from(arquivos)) {
      if (!/^image\/(jpeg|png|webp)$/.test(original.type)) {
        setErro(`${original.name}: use fotos JPEG, PNG ou WEBP.`);
        continue;
      }
      if (fotos.length >= MAX_FOTOS_LOTE) {
        setErro(`Use no máximo ${MAX_FOTOS_LOTE} fotos de cada vez.`);
        break;
      }
      try {
        const file = await prepareImageFile(original);
        const [mini, pequena] = await Promise.all([miniaturaParaAnalise(file), miniaturaParaAnalise(file, 512, 0.7)]);
        setFotos((lista) => (lista.length >= MAX_FOTOS_LOTE ? lista : [...lista, { id: novoId(), nome: original.name, file, url: URL.createObjectURL(file), mini, pequena }]));
      } catch (e) {
        setErro(`${original.name}: ${e instanceof Error ? e.message : "não foi possível ler a imagem."}`);
      }
    }
    if (input.current) input.current.value = "";
  }

  /** Fotos que ainda podem ser reorganizadas: as soltas e as de grupos que ainda não viraram rascunho. */
  const reorganizaveis = () => fotos.filter((f) => !grupos.some((g) => !editavel(g) && g.fotoIds.includes(f.id)));

  async function agruparComIa() {
    const alvo = reorganizaveis();
    if (alvo.length === 0 || ocupado) return;
    setAgrupando(true);
    setErro(null);
    try {
      const body = new FormData();
      alvo.forEach((f, i) => body.append("fotos", f.pequena, `foto-${i + 1}.jpg`));
      const res = await fetch("/api/produtos/ia/agrupar", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { grupos?: Array<{ indices: number[]; rotulo: string }>; entrada?: number; saida?: number; error?: string };
      if (!res.ok || !json.grupos) {
        setErro(json.error ?? "Não foi possível agrupar as fotos agora. Tente de novo.");
        return;
      }
      setCusto((c) => c + estimarCustoUsd(json.entrada ?? 0, json.saida ?? 0));
      const novos: Grupo[] = json.grupos.map((g) => ({ id: novoId(), rotulo: g.rotulo, notas: "", fotoIds: g.indices.map((i) => alvo[i]!.id), estado: "aguardando" }));
      setGrupos((lista) => [...lista.filter((g) => !editavel(g)), ...novos]);
    } catch {
      setErro("Não foi possível agrupar as fotos agora. Verifique a conexão e tente de novo.");
    } finally {
      setAgrupando(false);
    }
  }

  function umaPorFoto() {
    const alvo = reorganizaveis();
    const novos: Grupo[] = alvo.map((f, i) => ({ id: novoId(), rotulo: `Peça ${grupos.filter((g) => !editavel(g)).length + i + 1}`, notas: "", fotoIds: [f.id], estado: "aguardando" }));
    setGrupos((lista) => [...lista.filter((g) => !editavel(g)), ...novos]);
  }

  /** Move a foto para outro grupo ("novo" = peça nova, "tirar" = fora do lote, "solta" = sem peça). */
  function mover(fotoId: string, destino: string) {
    setGrupos((lista) => {
      const sem = lista.map((g) => ({ ...g, fotoIds: g.fotoIds.filter((id) => id !== fotoId) }));
      let resultado: Grupo[];
      if (destino === "novo") resultado = [...sem, { id: novoId(), rotulo: `Peça ${sem.length + 1}`, notas: "", fotoIds: [fotoId], estado: "aguardando" }];
      else if (destino === "tirar" || destino === "solta") resultado = sem;
      else resultado = sem.map((g) => (g.id === destino ? { ...g, fotoIds: [...g.fotoIds, fotoId] } : g));
      return resultado.filter((g) => g.fotoIds.length > 0 || !editavel(g));
    });
    if (destino === "tirar") {
      setFotos((lista) => {
        const f = lista.find((x) => x.id === fotoId);
        if (f) URL.revokeObjectURL(f.url);
        return lista.filter((x) => x.id !== fotoId);
      });
    }
  }

  async function prepararGrupo(g: Grupo): Promise<void> {
    const doGrupo = g.fotoIds.map((id) => foto(id)).filter((f): f is FotoLote => !!f);
    const passo = (texto: string) => patchGrupo(g.id, { estado: "preparando", passo: texto, mensagem: undefined });
    let rascunhoId = g.rascunhoId;
    try {
      passo("Criando o rascunho…");
      if (rascunhoId !== undefined) await descartarRascunhoAction(rascunhoId); // tentativa anterior que não terminou
      const r0 = await salvarRascunhoCampos(null, {
        notas: g.notas,
        form: { name: g.rotulo, description: "", tags: "", categorias: [], modo: "simples", cores: "", tamanhos: "", preco: "", promocional: "", peso: "", controlar: false, estoque: "", seoTitulo: "", seoDescricao: "", iaMarcados: [] },
        ia: null,
      });
      if (!r0.ok || !r0.id) throw new Error(r0.message ?? "Não foi possível criar o rascunho.");
      rascunhoId = r0.id;
      patchGrupo(g.id, { rascunhoId });

      const guardadas: FotoSalva[] = [];
      for (const [i, f] of doGrupo.entries()) {
        passo(`Guardando a foto ${i + 1} de ${doGrupo.length}…`);
        const body = new FormData();
        body.set("rascunho", String(rascunhoId));
        body.set("file", f.file);
        const res = await fetch("/api/produtos/rascunhos/fotos", { method: "POST", body }).catch(() => null);
        const json = (await res?.json().catch(() => null)) as (FotoSalva & { error?: string }) | null;
        if (!res || !res.ok || !json?.pathname) throw new Error(`Foto ${f.nome}: ${json?.error ?? "falha na conexão"}`);
        guardadas.push(json);
      }

      passo("A IA está analisando a peça…");
      const body = new FormData();
      doGrupo.forEach((f, i) => body.append("fotos", f.mini, `foto-${i + 1}.jpg`));
      body.set("anotacoes", g.notas);
      const res = await fetch("/api/produtos/ia/analisar", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as Partial<RascunhoIA> & { error?: string };
      if (!res.ok || !json.nome) {
        // o rascunho existe com as fotos; a análise pode ser refeita ao abri-lo
        patchGrupo(g.id, { estado: "erro", mensagem: `Rascunho criado com as fotos, mas a IA não analisou: ${json.error ?? "falha na análise"}. Abra-o em Rascunhos para tentar de novo.` });
        return;
      }
      const ia = json as RascunhoIA;
      setCusto((c) => c + estimarCustoUsd(ia.entrada, ia.saida));

      passo("Guardando o resultado…");
      const ordem = [ia.fotoPrincipal, ...doGrupo.map((_, i) => i).filter((i) => i !== ia.fotoPrincipal)];
      const s1 = await salvarRascunhoCampos(rascunhoId, {
        notas: g.notas,
        form: rascunhoParaForm(ia),
        ia: { avisos: ia.avisos, fotos: ordem.map((i) => ia.fotos[i] ?? { alt: "", qualidade: 3, observacao: "" }) },
      });
      if (!s1.ok) throw new Error(s1.message ?? "Não foi possível guardar o rascunho.");
      const s2 = await definirFotosRascunho(rascunhoId, ordem.map((i) => guardadas[i]!.pathname));
      if (!s2.ok) throw new Error(s2.message ?? "Não foi possível guardar as fotos.");
      patchGrupo(g.id, { estado: "pronto", passo: undefined, rascunhoId, avisos: ia.avisos });
    } catch (e) {
      patchGrupo(g.id, { estado: "erro", passo: undefined, rascunhoId, mensagem: e instanceof Error ? e.message : "Falha inesperada." });
    }
  }

  async function prepararTodos() {
    if (ocupado) return;
    const fila = grupos.filter(editavel);
    if (fila.length === 0) return;
    setPreparando(true);
    setErro(null);
    try {
      for (const g of fila) await prepararGrupo(g);
    } finally {
      setPreparando(false);
    }
  }

  const grandes = pendentes.filter((g) => g.fotoIds.length > MAX_FOTOS_IA);
  const prontos = grupos.filter((g) => g.estado === "pronto");

  const seletor = (f: FotoLote, atual: string) => (
    <select
      aria-label={`Mover a foto ${f.nome}`}
      value={atual}
      disabled={ocupado}
      onChange={(e) => mover(f.id, e.target.value)}
      className={`${fieldClass} min-h-8 py-1 text-xs`}
    >
      <option value={atual}>{atual === "solta" ? "Sem peça" : "Nesta peça"}</option>
      {atual !== "solta" && <option value="solta">Sem peça</option>}
      {grupos
        .filter((g) => editavel(g) && g.id !== atual)
        .map((g) => (
          <option key={g.id} value={g.id} disabled={g.fotoIds.length >= MAX_FOTOS_IA}>
            Mover para: {g.rotulo || "peça"}
            {g.fotoIds.length >= MAX_FOTOS_IA ? " (cheia)" : ""}
          </option>
        ))}
      <option value="novo">Mover para: nova peça</option>
      <option value="tirar">Tirar do lote</option>
    </select>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">1. Fotos</h2>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            if (e.dataTransfer.files.length > 0) void adicionar(e.dataTransfer.files);
          }}
          className={`flex flex-col items-center gap-2 rounded-md border-2 border-dashed p-5 text-center text-sm ${arrastando ? "border-primary bg-primary/5" : "border-border"}`}
        >
          <p className="font-medium">Arraste as fotos de várias peças aqui ou escolha arquivos</p>
          <p className="text-xs text-muted">Até {MAX_FOTOS_LOTE} fotos (JPEG, PNG ou WEBP) de uma vez; cada peça pode ter até {MAX_FOTOS_IA} fotos.</p>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" id="fotos-lote" onChange={(e) => e.target.files && void adicionar(e.target.files)} />
          <label htmlFor="fotos-lote" className="cursor-pointer rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-border/40">
            Escolher arquivos
          </label>
        </div>
        {erro && <Alert tone="danger" role="alert">{erro}</Alert>}
        {fotos.length > 0 && (
          <p className="text-sm text-muted">
            {fotos.length} {fotos.length === 1 ? "foto" : "fotos"}, {grupos.length} {grupos.length === 1 ? "peça" : "peças"}
            {soltas.length > 0 ? `, ${soltas.length} sem peça` : ""}.
          </p>
        )}
      </Card>

      {fotos.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">2. Separar por peça</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={ocupado || reorganizaveis().length === 0} onClick={() => void agruparComIa()}>
              {agrupando ? "A IA está agrupando…" : "Agrupar com a IA"}
            </Button>
            <Button type="button" variant="outline" disabled={ocupado || reorganizaveis().length === 0} onClick={umaPorFoto}>
              Uma peça por foto
            </Button>
            {custo > 0 && <span className="text-xs text-muted">Custo estimado até agora: US$ {custo.toFixed(2)}</span>}
          </div>
          <p className="text-xs text-muted">A IA junta as fotos da mesma peça (e o mesmo modelo em cores diferentes). Confira os grupos e corrija à mão: use o seletor de cada foto para movê-la.</p>

          {soltas.length > 0 && (
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium">Fotos sem peça ({soltas.length})</p>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {soltas.map((f) => (
                  <li key={f.id} className="flex flex-col gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.url} alt={f.nome} className="aspect-square w-full rounded object-cover" />
                    {seletor(f, "solta")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul className="flex flex-col gap-3">
            {grupos.map((g, n) => (
              <li key={g.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Peça {n + 1}</p>
                  <div className="flex items-center gap-2">
                    {g.estado === "pronto" ? <Badge tone="success">{ROTULO_ESTADO.pronto}</Badge> : g.estado === "erro" ? <Badge tone="danger">{ROTULO_ESTADO.erro}</Badge> : g.estado === "preparando" ? <Badge tone="warning">{g.passo ?? ROTULO_ESTADO.preparando}</Badge> : <Badge>{ROTULO_ESTADO.aguardando}</Badge>}
                    {g.rascunhoId !== undefined && (
                      <Link href={`/produtos/novo?rascunho=${g.rascunhoId}`} className="text-sm underline">
                        Abrir o rascunho
                      </Link>
                    )}
                  </div>
                </div>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {g.fotoIds.map((id) => {
                    const f = foto(id);
                    return f ? (
                      <li key={id} className="flex flex-col gap-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.url} alt={f.nome} className="aspect-square w-full rounded object-cover" />
                        {editavel(g) && seletor(f, g.id)}
                      </li>
                    ) : null;
                  })}
                </ul>
                {editavel(g) && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted">Nome provisório da peça</span>
                      <input value={g.rotulo} onChange={(e) => patchGrupo(g.id, { rotulo: e.target.value })} maxLength={80} disabled={ocupado} className={fieldClass} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted">O que você sabe da peça (opcional)</span>
                      <input value={g.notas} onChange={(e) => patchGrupo(g.id, { notas: e.target.value })} maxLength={500} disabled={ocupado} placeholder="Ex.: viscose, P M G, R$ 189,90" className={fieldClass} />
                    </label>
                  </div>
                )}
                {g.mensagem && <p className="text-sm text-danger">{g.mensagem}</p>}
                {g.avisos?.map((a) => (
                  <p key={a} className="text-sm text-warning">
                    ⚠ {a}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {grupos.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">3. Preparar os rascunhos</h2>
          <p className="text-sm text-muted">
            Para cada peça, a IA analisa as fotos e preenche o cadastro (de 10 a 20 segundos por peça, uma de cada vez). Mantenha esta página aberta; o que já ficou pronto fica salvo em Rascunhos mesmo se você sair.
          </p>
          {grandes.length > 0 && <Alert tone="danger">Há peças com mais de {MAX_FOTOS_IA} fotos. Mova algumas para outra peça.</Alert>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={ocupado || pendentes.length === 0 || grandes.length > 0 || soltas.length > 0} onClick={() => void prepararTodos()}>
              {preparando ? "Preparando…" : `Preparar ${pendentes.length} ${pendentes.length === 1 ? "rascunho" : "rascunhos"}`}
            </Button>
            {soltas.length > 0 && <span className="text-sm text-muted">Coloque as fotos soltas em uma peça (ou tire do lote) para continuar.</span>}
          </div>
          {prontos.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
              <p className="font-medium">
                {prontos.length} {prontos.length === 1 ? "rascunho pronto" : "rascunhos prontos"} para revisar
              </p>
              <Link href="/produtos/rascunhos" className="underline">
                Ver todos os rascunhos e criar os produtos
              </Link>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
