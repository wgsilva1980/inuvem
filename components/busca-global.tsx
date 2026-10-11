"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Perfil } from "@/lib/auth/perfis";
import { MIN_LETRAS, numeroDoPedido, type ResultadoBusca } from "@/lib/search/busca";
import { buscarPaginas, paginasDoPerfil } from "@/lib/search/paginas";

interface Item {
  chave: string;
  grupo: string;
  titulo: string;
  detalhe?: string;
  href: string;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string) => iso.slice(0, 10).split("-").reverse().slice(0, 2).join("/");
const PAGAMENTO: Record<string, string> = { paid: "pago", pending: "pagamento pendente", authorized: "autorizado", voided: "anulado", refunded: "reembolsado", abandoned: "abandonado" };

function itensDoServidor(r: ResultadoBusca): Item[] {
  return [
    ...r.produtos.map((p) => ({ chave: `p-${p.id}`, grupo: "Produtos", titulo: p.nome, detalhe: [p.sku ? `SKU ${p.sku}` : null, p.publicado ? null : "não publicado"].filter(Boolean).join(" · ") || undefined, href: `/produtos/${p.id}` })),
    ...r.pedidos.map((o) => ({
      chave: `o-${o.id}`,
      grupo: "Pedidos",
      titulo: `Pedido ${o.numero !== null ? `#${o.numero}` : o.id}`,
      detalhe: [dia(o.criadoEm), brl(o.total), o.pagamento ? (PAGAMENTO[o.pagamento] ?? o.pagamento) : null, o.aEnviar ? "a enviar" : null].filter(Boolean).join(" · "),
      href: o.aEnviar ? "/expedicao" : "/vendas",
    })),
    ...r.clientes.map((c) => ({ chave: `c-${c.id}`, grupo: "Clientes", titulo: c.nome, detalhe: c.local ?? undefined, href: `/contatos?q=${encodeURIComponent(c.nome)}` })),
    ...r.categorias.map((c) => ({ chave: `k-${c.id}`, grupo: "Categorias", titulo: c.nome, href: `/produtos?categoria=${c.id}` })),
  ];
}

/**
 * Busca global (Ctrl+K ou ⌘K). Páginas do painel são filtradas na hora; produtos, pedidos (pelo número), clientes e categorias vêm de /api/busca.
 * O perfil restrito só procura as próprias páginas.
 */
export function BuscaGlobal({ aberta, onFechar, perfil }: { aberta: boolean; onFechar: () => void; perfil: Perfil }) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [servidor, setServidor] = useState<ResultadoBusca | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ativo, setAtivo] = useState(0);
  const entrada = useRef<HTMLInputElement>(null);
  const paginas = useMemo(() => paginasDoPerfil(perfil), [perfil]);
  const podeBuscarNoServidor = perfil === "admin";

  // Foca o campo ao abrir; limpa ao fechar.
  useEffect(() => {
    if (aberta) setTimeout(() => entrada.current?.focus(), 0);
    else {
      setTexto("");
      setServidor(null);
      setErro(null);
      setAtivo(0);
    }
  }, [aberta]);

  // Busca no servidor com pequena espera entre as teclas; a resposta antiga é descartada.
  useEffect(() => {
    if (!aberta || !podeBuscarNoServidor) return;
    const q = texto.trim();
    if (q.length < MIN_LETRAS && numeroDoPedido(q) === null) {
      setServidor(null);
      setCarregando(false);
      setErro(null);
      return;
    }
    const controle = new AbortController();
    setCarregando(true);
    const espera = setTimeout(async () => {
      try {
        const res = await fetch(`/api/busca?q=${encodeURIComponent(q)}`, { signal: controle.signal });
        const dados = (await res.json().catch(() => ({}))) as Partial<ResultadoBusca> & { error?: string };
        if (!res.ok) throw new Error(dados.error ?? "Não foi possível buscar agora.");
        setServidor({ produtos: dados.produtos ?? [], pedidos: dados.pedidos ?? [], clientes: dados.clientes ?? [], categorias: dados.categorias ?? [] });
        setErro(null);
      } catch (e) {
        if (controle.signal.aborted) return;
        setErro(e instanceof Error ? e.message : "Falha ao buscar.");
      } finally {
        if (!controle.signal.aborted) setCarregando(false);
      }
    }, 250);
    return () => {
      clearTimeout(espera);
      controle.abort();
    };
  }, [texto, aberta, podeBuscarNoServidor]);

  const itens: Item[] = useMemo(() => {
    const doPainel = buscarPaginas(paginas, texto).map((p) => ({ chave: `pg-${p.href}`, grupo: "Páginas do painel", titulo: p.label, href: p.href }));
    return [...(servidor ? itensDoServidor(servidor) : []), ...doPainel];
  }, [paginas, texto, servidor]);

  useEffect(() => setAtivo(0), [itens.length, texto]);

  function ir(item: Item | undefined) {
    if (!item) return;
    onFechar();
    router.push(item.href);
  }

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onFechar();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setAtivo((a) => (itens.length === 0 ? 0 : (a + 1) % itens.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo((a) => (itens.length === 0 ? 0 : (a - 1 + itens.length) % itens.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      ir(itens[ativo]);
    } else if (e.key === "Tab") {
      e.preventDefault(); // o foco fica no campo: a lista se navega pelas setas
    }
  }

  // Rola o item ativo para dentro da vista.
  useEffect(() => {
    document.getElementById(`busca-op-${ativo}`)?.scrollIntoView({ block: "nearest" });
  }, [ativo]);

  if (!aberta) return null;
  const grupos = [...new Set(itens.map((i) => i.grupo))];
  const q = texto.trim();
  const semResultado = q.length > 0 && itens.length === 0 && !carregando;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div role="dialog" aria-modal="true" aria-label="Buscar no painel" className="flex max-h-[75vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl" onKeyDown={aoTeclar}>
        <input
          ref={entrada}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          role="combobox"
          aria-expanded="true"
          aria-controls="busca-lista"
          aria-activedescendant={itens.length > 0 ? `busca-op-${ativo}` : undefined}
          aria-label="Buscar produto, pedido, cliente, categoria ou página"
          placeholder={podeBuscarNoServidor ? "Produto, SKU, nº do pedido, cliente, categoria ou página…" : "Ir para uma página…"}
          autoComplete="off"
          className="min-h-12 w-full border-b border-border bg-transparent px-4 py-3 text-base outline-none placeholder:text-muted"
        />
        <div id="busca-lista" role="listbox" className="flex-1 overflow-y-auto p-1">
          {grupos.map((g) => (
            <div key={g} role="group" aria-label={g}>
              <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{g}</p>
              {itens.map((it, i) =>
                it.grupo !== g ? null : (
                  <div
                    key={it.chave}
                    id={`busca-op-${i}`}
                    role="option"
                    aria-selected={i === ativo}
                    onMouseEnter={() => setAtivo(i)}
                    onClick={() => ir(it)}
                    className={`flex min-h-11 cursor-pointer flex-col justify-center rounded-md px-3 py-1.5 text-sm ${i === ativo ? "bg-border/60" : ""}`}
                  >
                    <span className="font-medium">{it.titulo}</span>
                    {it.detalhe && <span className="text-xs text-muted">{it.detalhe}</span>}
                  </div>
                ),
              )}
            </div>
          ))}
          {carregando && <p className="px-3 py-2 text-sm text-muted">Buscando…</p>}
          {erro && (
            <p role="alert" className="px-3 py-2 text-sm text-danger">
              {erro}
            </p>
          )}
          {semResultado && <p className="px-3 py-3 text-sm text-muted">Nada encontrado para “{q}”.</p>}
          {q.length === 0 && podeBuscarNoServidor && <p className="px-3 py-2 text-xs text-muted">Digite ao menos {MIN_LETRAS} letras, ou o número de um pedido. Use ↑ ↓ e Enter; Esc fecha.</p>}
        </div>
      </div>
    </div>
  );
}
