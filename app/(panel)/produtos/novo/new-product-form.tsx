"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldClass } from "@/components/ui/field";
import { RichTextEditor } from "@/components/rich-text-editor";
import { MAX_VARIANTS, gerarCombinacoes, parseCores, parseTamanhos } from "@/lib/catalog/create";
import type { RascunhoAtual, RascunhoIA } from "@/lib/catalog/ai-draft-shared";
import { aplicarEnquadramento, type EnquadramentoFoto, type FormSalvo, type FotoSalva } from "@/lib/catalog/drafts-shared";
import type { CategoryOption } from "@/lib/catalog/query";
import type { SugestoesCategoria } from "@/lib/catalog/store-context";
import { textoDaDescricao } from "@/lib/seo/text";
import { uploadProductImage } from "../[id]/media-actions";
import { criarProdutoComFotos, type NovoProdutoResultado } from "./actions";
import { enviarFotoRascunho, marcarRascunhoCriado } from "./rascunhos-actions";

type Linha = { preco?: string; promo?: string; sku?: string; estoque?: string };
const label = "flex flex-col gap-1 text-sm";

/** Foto escolhida no cadastro: o arquivo (ou a cópia guardada no rascunho) vai para a loja depois que o produto é criado. */
export interface FotoNova {
  id: string;
  file?: File;
  /** Já guardada no rascunho (Blob): o servidor a envia à loja sem passar pelo navegador. */
  salva?: FotoSalva;
  nome: string;
  /** Enquadramento escolhido (ausente = automático). */
  opcoes?: EnquadramentoFoto;
}

/** Rascunho da IA para aplicar no formulário. "completo" = primeira análise (preenche tudo); "ajuste" = só refaz os textos. */
export interface Inicial {
  versao: number;
  modo: "completo" | "ajuste";
  dados: RascunhoIA;
}

type FotoEstado = { estado: "enviando" | "ok" | "erro"; mensagem?: string };

/** Etiqueta dos campos preenchidos pela IA; some quando a pessoa edita o campo. */
/** Quantidade digitada (vazia/inválida conta 0) — só para os totais da grade de estoque. */
const qtd = (v: string) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function IaTag({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">✨ Sugerido pela IA</span>;
}

interface FormProps {
  categories: CategoryOption[];
  fotos: FotoNova[];
  inicial: Inicial | null;
  atualRef: MutableRefObject<() => RascunhoAtual>;
  /** Campos guardados de um rascunho: começam preenchidos assim (a IA não reescreve por cima). */
  salvo?: FormSalvo | null;
  /** O rascunho já tinha análise da IA (destaca o que falta). */
  analisado?: boolean;
  /** Preenchido pelo formulário: devolve os campos como estão agora, para guardar no rascunho. */
  coletarRef: MutableRefObject<() => FormSalvo>;
  rascunhoId: number | null;
  /** Guarda o rascunho (campos + fotos); devolve a mensagem para mostrar. */
  onSalvarRascunho: () => Promise<string>;
  onDescartarRascunho?: () => void;
}

export function NewProductForm({ categories, fotos, inicial, atualRef, salvo = null, analisado: analisadoProp = false, coletarRef, rascunhoId, onSalvarRascunho, onDescartarRascunho }: FormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [resultado, setResultado] = useState<NovoProdutoResultado | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [salvandoRascunho, setSalvandoRascunho] = useState(false);
  const [msgRascunho, setMsgRascunho] = useState<string | null>(null);
  const [criadoId, setCriadoId] = useState<number | null>(null);
  const [fotoEstado, setFotoEstado] = useState<Record<string, FotoEstado>>({});
  const err = (name: string) => resultado?.fieldErrors?.[name];

  const [nome, setNome] = useState(salvo?.name ?? "");
  const [descInicial, setDescInicial] = useState(salvo?.description ?? "");
  const [descVersao, setDescVersao] = useState(0);
  const [tags, setTags] = useState(salvo?.tags ?? "");
  const [cats, setCats] = useState<Set<number>>(new Set(salvo?.categorias.filter((id) => categories.some((c) => c.id === id)) ?? []));
  const [seoTitulo, setSeoTitulo] = useState(salvo?.seoTitulo ?? "");
  const [seoDescricao, setSeoDescricao] = useState(salvo?.seoDescricao ?? "");
  const [peso, setPeso] = useState(salvo?.peso ?? "");
  const [ia, setIa] = useState<Set<string>>(new Set(salvo?.iaMarcados ?? []));
  const limparIa = (k: string) => setIa((prev) => (prev.has(k) ? new Set([...prev].filter((x) => x !== k)) : prev));

  const [modo, setModo] = useState<"simples" | "variacoes">(salvo?.modo ?? "simples");
  const [controlar, setControlar] = useState(salvo?.controlar ?? true);
  const [coresTexto, setCoresTexto] = useState(salvo?.cores ?? "");
  const [tamanhosTexto, setTamanhosTexto] = useState(salvo?.tamanhos ?? "");
  const [precoPadrao, setPrecoPadrao] = useState(salvo?.preco ?? "");
  const [promoPadrao, setPromoPadrao] = useState(salvo?.promocional ?? "");
  const [estoquePadrao, setEstoquePadrao] = useState(salvo?.estoque ?? "");
  const [linhas, setLinhas] = useState<Record<string, Linha>>({});

  // Referência da loja: o que costuma ser feito nas categorias escolhidas (preço, tamanhos, peso). Só sugere; nunca preenche sozinho.
  const [sugestoes, setSugestoes] = useState<SugestoesCategoria | null>(null);
  const categoriasChave = [...cats].sort((a, b) => a - b).join(",");
  useEffect(() => {
    if (!categoriasChave) {
      setSugestoes(null);
      return;
    }
    const ctrl = new AbortController();
    const espera = setTimeout(() => {
      fetch(`/api/produtos/ia/sugestoes?categorias=${categoriasChave}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<SugestoesCategoria>) : null))
        .then((j) => j && setSugestoes(j))
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(espera);
      ctrl.abort();
    };
  }, [categoriasChave]);

  // O assistente deixa o rascunho pronto: aplica nos campos (a pessoa confere e edita antes de criar).
  const versaoAplicada = useRef(salvo || analisadoProp ? 1 : 0);
  useEffect(() => {
    if (!inicial || inicial.versao === versaoAplicada.current) return;
    versaoAplicada.current = inicial.versao;
    const d = inicial.dados;
    const marcar = new Set<string>(["name", "description", "seo_title", "seo_description"]);
    setNome(d.nome);
    setDescInicial(d.descricaoHtml);
    setDescVersao((v) => v + 1);
    setSeoTitulo(d.seoTitulo);
    setSeoDescricao(d.seoDescricao);
    if (d.tags) {
      setTags(d.tags);
      marcar.add("tags");
    }
    if (inicial.modo === "completo") {
      if (d.categoriaIds.length > 0) {
        setCats(new Set(d.categoriaIds.filter((id) => categories.some((c) => c.id === id))));
        marcar.add("categories");
      }
      if (d.cores.length > 0 && coresTexto.trim() === "") {
        setCoresTexto(d.cores.join(", "));
        marcar.add("cores");
      }
      if (d.tamanhos.length > 0 && tamanhosTexto.trim() === "") {
        setTamanhosTexto(d.tamanhos.join(", "));
        marcar.add("tamanhos");
      }
      if (d.cores.length > 0 || d.tamanhos.length > 0) setModo("variacoes");
      if (d.preco && precoPadrao.trim() === "") {
        setPrecoPadrao(d.preco);
        marcar.add("preco");
      }
      if (d.promocional && promoPadrao.trim() === "") {
        setPromoPadrao(d.promocional);
        marcar.add("promocional");
      }
      if (d.pesoKg && peso.trim() === "") {
        setPeso(d.pesoKg);
        marcar.add("peso");
      }
    }
    setIa((prev) => new Set([...prev, ...marcar]));
  });

  // A tela mostra o rascunho atual para o assistente (pedido de ajuste parte do que está nos campos).
  atualRef.current = () => {
    const html = (formRef.current?.elements.namedItem("description") as HTMLInputElement | null)?.value ?? descInicial;
    return { nome, descricao: textoDaDescricao(html, 2000), tags, seoTitulo, seoDescricao };
  };

  // Para guardar o rascunho: os campos como estão agora.
  coletarRef.current = () => ({
    name: nome,
    description: (formRef.current?.elements.namedItem("description") as HTMLInputElement | null)?.value ?? descInicial,
    tags,
    categorias: [...cats],
    modo,
    cores: coresTexto,
    tamanhos: tamanhosTexto,
    preco: precoPadrao,
    promocional: promoPadrao,
    peso,
    controlar,
    estoque: estoquePadrao,
    seoTitulo,
    seoDescricao,
    iaMarcados: [...ia],
  });

  // Campos que a IA não tem como saber ficam em destaque depois da análise.
  const analisado = inicial !== null || analisadoProp;
  const destaque = (vazio: boolean) => (analisado && vazio ? "border-warning ring-1 ring-warning/60" : "");

  const cores = useMemo(() => parseCores(coresTexto), [coresTexto]);
  const tamanhos = useMemo(() => parseTamanhos(tamanhosTexto), [tamanhosTexto]);
  const combos = useMemo(() => gerarCombinacoes(cores, tamanhos), [cores, tamanhos]);
  const grandeDemais = combos.length > MAX_VARIANTS;

  const editar = (chave: string, campo: keyof Linha, valor: string) => setLinhas((prev) => ({ ...prev, [chave]: { ...prev[chave], [campo]: valor } }));

  /** Cria o produto (uma vez) e envia as fotos, uma a uma, com a padronização automática; as que falharem podem ser reenviadas. */
  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    const dados = new FormData(e.currentTarget);
    setEnviando(true);
    setResultado(null);
    try {
      let id = criadoId;
      if (id === null) {
        const r = await criarProdutoComFotos(dados);
        if (r.id === undefined) {
          setResultado(r);
          return;
        }
        id = r.id;
        setCriadoId(id);
        if (rascunhoId !== null) void marcarRascunhoCriado(rascunhoId, id);
      }
      let falhou = false;
      for (const f of fotos) {
        if (fotoEstado[f.id]?.estado === "ok") continue;
        setFotoEstado((prev) => ({ ...prev, [f.id]: { estado: "enviando" } }));
        let r: { ok?: boolean; message?: string };
        try {
          if (f.file) {
            const body = new FormData();
            body.set("file", f.file);
            body.set("padronizar", "1");
            aplicarEnquadramento(body, f.opcoes);
            r = await uploadProductImage(id, body);
          } else if (f.salva && rascunhoId !== null) {
            r = await enviarFotoRascunho(rascunhoId, id, f.salva.pathname, f.opcoes);
          } else r = { ok: false, message: "Foto sem arquivo." };
        } catch {
          r = { ok: false, message: "Falhou. Tente de novo." };
        }
        if (r.ok) setFotoEstado((prev) => ({ ...prev, [f.id]: { estado: "ok" } }));
        else {
          falhou = true;
          setFotoEstado((prev) => ({ ...prev, [f.id]: { estado: "erro", mensagem: r.message ?? "Falhou." } }));
        }
      }
      if (!falhou) router.push(`/produtos/${id}?criado=1`);
    } catch {
      setResultado({ message: "Falha inesperada. Tente de novo." });
    } finally {
      setEnviando(false);
    }
  }

  const fotosPendentes = fotos.filter((f) => fotoEstado[f.id]?.estado !== "ok").length;
  const travado = enviando || criadoId !== null;

  async function salvarRascunho() {
    if (salvandoRascunho || enviando) return;
    setSalvandoRascunho(true);
    setMsgRascunho(null);
    try {
      setMsgRascunho(await onSalvarRascunho());
    } finally {
      setSalvandoRascunho(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={enviar} className="flex flex-col gap-4">
      <fieldset disabled={travado} className="contents">
      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Dados do produto</h2>
        <label className={label}>
          <span className="font-medium">
            Nome
            <IaTag show={ia.has("name")} />
          </span>
          <input name="name" required maxLength={255} value={nome} onChange={(e) => (setNome(e.target.value), limparIa("name"))} className={fieldClass} aria-invalid={!!err("name")} />
          {err("name") && <span className="text-danger">{err("name")}</span>}
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="description-editor" className="font-medium">
            Descrição
            <IaTag show={ia.has("description")} />
          </label>
          <RichTextEditor key={descVersao} name="description" defaultValue={descInicial} id="description-editor" onChange={() => limparIa("description")} />
          {err("description") && <span className="text-danger">{err("description")}</span>}
        </div>
        <label className={label}>
          <span className="font-medium">
            Tags (separadas por vírgula)
            <IaTag show={ia.has("tags")} />
          </span>
          <input name="tags" value={tags} onChange={(e) => (setTags(e.target.value), limparIa("tags"))} className={fieldClass} />
          {err("tags") && <span className="text-danger">{err("tags")}</span>}
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="published" className="mt-1" />
          <span>
            <span className="font-medium">Publicar na loja agora</span>
            <span className="block text-muted">Desmarcado, o produto é criado como rascunho (não aparece na vitrine) e você publica quando as fotos e os dados estiverem prontos.</span>
          </span>
        </label>
      </Card>

      <Card>
        <h2 className="text-base font-semibold">
          Categorias
          <IaTag show={ia.has("categories")} />
        </h2>
        {categories.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nenhuma categoria sincronizada.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {categories.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="categories"
                    value={c.id}
                    checked={cats.has(c.id)}
                    onChange={(e) => {
                      setCats((prev) => {
                        const n = new Set(prev);
                        if (e.target.checked) n.add(c.id);
                        else n.delete(c.id);
                        return n;
                      });
                      limparIa("categories");
                    }}
                  />
                  <span>{c.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Preço e variações</h2>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="sr-only">Tipo de produto</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="modo" value="simples" checked={modo === "simples"} onChange={() => setModo("simples")} className="mt-1" />
            <span>
              <span className="font-medium">Produto simples</span>
              <span className="block text-muted">Uma variante só, sem cor nem tamanho para escolher.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="modo" value="variacoes" checked={modo === "variacoes"} onChange={() => setModo("variacoes")} className="mt-1" />
            <span>
              <span className="font-medium">Com cores e tamanhos</span>
              <span className="block text-muted">Cria uma variante para cada combinação, com as propriedades COR e TAMANHO. Para tamanho único, use ÚNICO.</span>
            </span>
          </label>
        </fieldset>

        {sugestoes && (sugestoes.preco || sugestoes.tamanhos || sugestoes.pesoKg) && (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-border/20 p-3 text-sm">
            <p className="font-medium">
              💡 Referência da loja{" "}
              <span className="font-normal text-muted">
                (nas categorias escolhidas, {sugestoes.produtos} {sugestoes.produtos === 1 ? "produto publicado" : "produtos publicados"}; é só uma sugestão)
              </span>
            </p>
            {sugestoes.preco && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>
                  Preço: costuma ficar entre R$ {sugestoes.preco.minimo} e R$ {sugestoes.preco.maximo} (mediana R$ {sugestoes.preco.mediana}, {sugestoes.preco.produtos} produtos).
                </span>
                <button type="button" onClick={() => (setPrecoPadrao(sugestoes.preco!.mediana), limparIa("preco"))} className="underline">
                  Usar R$ {sugestoes.preco.mediana}
                </button>
              </p>
            )}
            {sugestoes.tamanhos && modo === "variacoes" && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>
                  Tamanhos: o mais usado é {sugestoes.tamanhos.lista.join(", ")} ({sugestoes.tamanhos.produtos} de {sugestoes.tamanhos.de} produtos).
                </span>
                <button type="button" onClick={() => (setTamanhosTexto(sugestoes.tamanhos!.lista.join(", ")), limparIa("tamanhos"))} className="underline">
                  Usar
                </button>
              </p>
            )}
            {sugestoes.pesoKg && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>
                  Peso: o mais comum é {sugestoes.pesoKg.valor} kg ({sugestoes.pesoKg.produtos} produtos).
                </span>
                <button type="button" onClick={() => (setPeso(sugestoes.pesoKg!.valor), limparIa("peso"))} className="underline">
                  Usar
                </button>
              </p>
            )}
          </div>
        )}

        {modo === "simples" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <label className={label}>
              <span className="text-muted">
                Preço (R$)
                <IaTag show={ia.has("preco")} />
              </span>
              <input name="preco" value={precoPadrao} onChange={(e) => (setPrecoPadrao(e.target.value), limparIa("preco"))} inputMode="decimal" required className={`${fieldClass} ${destaque(precoPadrao.trim() === "")}`} aria-invalid={!!err("preco")} />
              {err("preco") && <span className="text-danger">{err("preco")}</span>}
            </label>
            <label className={label}>
              <span className="text-muted">Promocional (R$)</span>
              <input name="promocional" value={promoPadrao} onChange={(e) => setPromoPadrao(e.target.value)} inputMode="decimal" className={fieldClass} />
              {err("promocional") && <span className="text-danger">{err("promocional")}</span>}
            </label>
            <label className={label}>
              <span className="text-muted">SKU</span>
              <input name="sku" maxLength={255} placeholder="Automático" className={fieldClass} />
              {err("sku") && <span className="text-danger">{err("sku")}</span>}
            </label>
            <label className={label}>
              <span className="text-muted">
                Peso (kg)
                <IaTag show={ia.has("peso")} />
              </span>
              <input name="peso" value={peso} onChange={(e) => (setPeso(e.target.value), limparIa("peso"))} inputMode="decimal" className={`${fieldClass} ${destaque(peso.trim() === "")}`} />
              {err("peso") && <span className="text-danger">{err("peso")}</span>}
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm sm:col-span-2">
              <input type="checkbox" name="controlar_estoque" checked={controlar} onChange={(e) => setControlar(e.target.checked)} />
              <span>Controlar estoque</span>
            </label>
            {controlar && (
              <label className={label}>
                <span className="text-muted">Estoque</span>
                <input name="estoque" value={estoquePadrao} onChange={(e) => setEstoquePadrao(e.target.value)} inputMode="numeric" className={fieldClass} />
                {err("estoque") && <span className="text-danger">{err("estoque")}</span>}
              </label>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={label}>
                <span className="font-medium">
                  Cores
                  <IaTag show={ia.has("cores")} />
                </span>
                <textarea value={coresTexto} onChange={(e) => (setCoresTexto(e.target.value), limparIa("cores"))} rows={3} placeholder="Preta, Branca, Azul Claro" className={`${fieldClass} ${destaque(coresTexto.trim() === "")}`} />
                <span className="text-xs text-muted">Separe por vírgula ou linha. A grafia é padronizada (“azul claro” vira “Azul Claro”).</span>
              </label>
              <label className={label}>
                <span className="font-medium">
                  Tamanhos
                  <IaTag show={ia.has("tamanhos")} />
                </span>
                <textarea value={tamanhosTexto} onChange={(e) => (setTamanhosTexto(e.target.value), limparIa("tamanhos"))} rows={3} placeholder="PP, P, M, G, GG" className={`${fieldClass} ${destaque(tamanhosTexto.trim() === "")}`} />
                <span className="text-xs text-muted">Tamanhos ficam em maiúsculas. Para tamanho único, escreva ÚNICO.</span>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
              <label className={label}>
                <span className="text-muted">
                  Preço padrão (R$)
                  <IaTag show={ia.has("preco")} />
                </span>
                <input value={precoPadrao} onChange={(e) => (setPrecoPadrao(e.target.value), limparIa("preco"))} inputMode="decimal" className={`${fieldClass} ${destaque(precoPadrao.trim() === "")}`} />
              </label>
              <label className={label}>
                <span className="text-muted">Promocional padrão (R$)</span>
                <input value={promoPadrao} onChange={(e) => setPromoPadrao(e.target.value)} inputMode="decimal" className={fieldClass} />
              </label>
              <label className={label}>
                <span className="text-muted">Peso (kg), todas</span>
                <input name="peso_v" value={peso} onChange={(e) => (setPeso(e.target.value), limparIa("peso"))} inputMode="decimal" className={`${fieldClass} ${destaque(peso.trim() === "")}`} aria-invalid={!!err("peso_v")} />
                {err("peso_v") && <span className="text-danger">{err("peso_v")}</span>}
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" name="controlar_estoque_v" checked={controlar} onChange={(e) => setControlar(e.target.checked)} />
                <span>Controlar estoque</span>
              </label>
              {controlar && (
                <label className={label}>
                  <span className="text-muted">Estoque padrão (cada variação)</span>
                  <input value={estoquePadrao} onChange={(e) => setEstoquePadrao(e.target.value)} inputMode="numeric" className={fieldClass} />
                </label>
              )}
            </div>
            <p className="text-xs text-muted">Os valores padrão preenchem todas as variantes abaixo; você pode ajustar uma por uma.</p>

            {combos.length === 0 ? (
              <p className="rounded-md border border-border p-3 text-sm text-muted">Digite as cores e os tamanhos acima para ver as variantes.</p>
            ) : grandeDemais ? (
              <Alert tone="danger">
                São {combos.length} variantes; o máximo ao cadastrar é {MAX_VARIANTS}. Reduza as cores ou os tamanhos (você pode criar mais depois, na tela do produto).
              </Alert>
            ) : (
              <>
                <input type="hidden" name="vcount" value={combos.length} />
                <p className="text-sm font-medium">
                  {combos.length} {combos.length === 1 ? "variante" : "variantes"}
                </p>
                {controlar && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Estoque de cada variação</p>
                    <div className="overflow-x-auto rounded-md border border-border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-muted">
                            <th className="p-2 font-medium">Cor</th>
                            {tamanhos.map((t) => (
                              <th key={t} className="p-2 font-medium">{t}</th>
                            ))}
                            <th className="p-2 font-medium">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cores.map((cor) => (
                            <tr key={cor} className="border-t border-border">
                              <th className="p-2 text-left font-medium">{cor}</th>
                              {tamanhos.map((t) => {
                                const chave = `${cor}|${t}`;
                                const i = combos.findIndex((c) => c.cor === cor && c.tamanho === t);
                                return (
                                  <td key={t} className="p-1">
                                    <input aria-label={`Estoque ${cor} ${t}`} value={linhas[chave]?.estoque ?? estoquePadrao} onChange={(e) => editar(chave, "estoque", e.target.value)} inputMode="numeric" className={`${fieldClass} w-20`} aria-invalid={!!err(`v_${i}_estoque`)} />
                                  </td>
                                );
                              })}
                              <td className="p-2 font-medium">{tamanhos.reduce((s, t) => s + qtd(linhas[`${cor}|${t}`]?.estoque ?? estoquePadrao), 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-border font-medium">
                            <th className="p-2 text-left">Total</th>
                            {tamanhos.map((t) => (
                              <td key={t} className="p-2">{cores.reduce((s, cor) => s + qtd(linhas[`${cor}|${t}`]?.estoque ?? estoquePadrao), 0)}</td>
                            ))}
                            <td className="p-2">{combos.reduce((s, c) => s + qtd(linhas[`${c.cor}|${c.tamanho}`]?.estoque ?? estoquePadrao), 0)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    {combos.map((c, i) => err(`v_${i}_estoque`) && <p key={`${c.cor}|${c.tamanho}`} className="text-sm text-danger">{c.cor} / {c.tamanho}: {err(`v_${i}_estoque`)}</p>)}
                  </div>
                )}
                <ul className="flex flex-col gap-3">
                  {combos.map((c, i) => {
                    const chave = `${c.cor}|${c.tamanho}`;
                    const l = linhas[chave] ?? {};
                    return (
                      <li key={chave} className="flex flex-col gap-2 rounded-md border border-border p-3">
                        <input type="hidden" name={`v_${i}_cor`} value={c.cor} />
                        <input type="hidden" name={`v_${i}_tam`} value={c.tamanho} />
                        <p className="text-sm font-medium">
                          {c.cor} / {c.tamanho}
                        </p>
                        {err(`v_${i}_cor`) && <p className="text-sm text-danger">{err(`v_${i}_cor`)}</p>}
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <label className={label}>
                            <span className="text-muted">Preço (R$)</span>
                            <input name={`v_${i}_preco`} value={l.preco ?? precoPadrao} onChange={(e) => editar(chave, "preco", e.target.value)} inputMode="decimal" className={fieldClass} aria-invalid={!!err(`v_${i}_preco`)} />
                            {err(`v_${i}_preco`) && <span className="text-danger">{err(`v_${i}_preco`)}</span>}
                          </label>
                          <label className={label}>
                            <span className="text-muted">Promocional</span>
                            <input name={`v_${i}_promo`} value={l.promo ?? promoPadrao} onChange={(e) => editar(chave, "promo", e.target.value)} inputMode="decimal" className={fieldClass} />
                            {err(`v_${i}_promo`) && <span className="text-danger">{err(`v_${i}_promo`)}</span>}
                          </label>
                          <label className={label}>
                            <span className="text-muted">SKU</span>
                            <input name={`v_${i}_sku`} value={l.sku ?? ""} onChange={(e) => editar(chave, "sku", e.target.value)} maxLength={255} placeholder="Automático" className={fieldClass} />
                            {err(`v_${i}_sku`) && <span className="text-danger">{err(`v_${i}_sku`)}</span>}
                          </label>
                          {controlar && <input type="hidden" name={`v_${i}_estoque`} value={l.estoque ?? estoquePadrao} />}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {err("variantes") && <p className="text-sm text-danger">{err("variantes")}</p>}
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">SEO</h2>
        <label className={label}>
          <span className="font-medium">
            Título (até 70 caracteres)
            <IaTag show={ia.has("seo_title")} />
          </span>
          <input name="seo_title" maxLength={70} value={seoTitulo} onChange={(e) => (setSeoTitulo(e.target.value), limparIa("seo_title"))} className={fieldClass} />
          {err("seo_title") && <span className="text-danger">{err("seo_title")}</span>}
        </label>
        <label className={label}>
          <span className="font-medium">
            Descrição (até 320 caracteres)
            <IaTag show={ia.has("seo_description")} />
          </span>
          <textarea name="seo_description" rows={3} maxLength={320} value={seoDescricao} onChange={(e) => (setSeoDescricao(e.target.value), limparIa("seo_description"))} className={fieldClass} />
          {err("seo_description") && <span className="text-danger">{err("seo_description")}</span>}
        </label>
      </Card>

      </fieldset>

      {fotos.length > 0 && criadoId !== null && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Envio das fotos</h2>
          <p className="text-sm text-muted">O produto foi criado como rascunho. As fotos são padronizadas e enviadas uma a uma.</p>
          <ul className="flex flex-col gap-1 text-sm">
            {fotos.map((f, i) => {
              const st = fotoEstado[f.id];
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate">
                    {i + 1}. {f.nome}
                  </span>
                  <span className={st?.estado === "ok" ? "text-success" : st?.estado === "erro" ? "text-danger" : "text-muted"}>
                    {st?.estado === "ok" ? "enviada" : st?.estado === "enviando" ? "enviando…" : st?.estado === "erro" ? `falhou: ${st.mensagem}` : "na fila"}
                  </span>
                </li>
              );
            })}
          </ul>
          {!enviando && fotosPendentes > 0 && (
            <p className="text-sm">
              Algumas fotos não foram enviadas. Use o botão abaixo para tentar de novo, ou{" "}
              <a href={`/produtos/${criadoId}?criado=1`} className="underline">
                abra o produto
              </a>{" "}
              e adicione as fotos por lá.
            </p>
          )}
        </Card>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card px-4 py-3 shadow-lg">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm" aria-live="polite">
            {resultado?.message ? (
              <Alert tone="danger" className="border-0 p-0">
                {resultado.message}
              </Alert>
            ) : msgRascunho ? (
              <span className="text-muted">{msgRascunho}</span>
            ) : (
              <span className="text-muted">{criadoId !== null ? "Produto criado como rascunho." : "Nada é enviado à loja até você clicar em “Criar produto”."}</span>
            )}
          </div>
          {criadoId === null && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={salvandoRascunho || enviando} onClick={() => void salvarRascunho()} className="min-h-11">
                {salvandoRascunho ? "Salvando…" : rascunhoId !== null ? "Salvar rascunho" : "Salvar como rascunho"}
              </Button>
              {rascunhoId !== null && onDescartarRascunho && (
                <Button type="button" variant="outline" disabled={salvandoRascunho || enviando} onClick={onDescartarRascunho} className="min-h-11">
                  Descartar rascunho
                </Button>
              )}
            </div>
          )}
          <Button type="submit" disabled={enviando || (criadoId !== null && fotosPendentes === 0) || (criadoId === null && modo === "variacoes" && (combos.length === 0 || grandeDemais))} className="min-h-11">
            {enviando
              ? criadoId === null
                ? "Criando…"
                : "Enviando fotos…"
              : criadoId !== null
                ? "Tentar enviar as fotos de novo"
                : fotos.length > 0
                  ? `Criar produto e enviar ${fotos.length} ${fotos.length === 1 ? "foto" : "fotos"}`
                  : "Criar produto"}
          </Button>
        </div>
      </div>
    </form>
  );
}
