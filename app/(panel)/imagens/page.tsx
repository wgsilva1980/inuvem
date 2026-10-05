import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { query } from "@/lib/db";
import { PROBLEMA_LABEL, auditarProdutos, proporcaoTexto, resumirAuditoria, type Problema, type ProdutoAuditado } from "@/lib/images/audit";
import { getActiveStore } from "@/lib/stores";
import { AuditRunner } from "./runner";
import { StorageCheck } from "./storage-check";

export const dynamic = "force-dynamic";
const POR_PAGINA = 25;
const PROBLEMAS = Object.keys(PROBLEMA_LABEL) as Problema[];
type Filtro = Problema | "mistas" | "sem-imagem" | "todos";

const kb = (n: number | null) => (n === null ? "—" : `${Math.round(n / 1024)} KB`);

function filtrar(produtos: ProdutoAuditado[], filtro: Filtro): ProdutoAuditado[] {
  if (filtro === "todos") return produtos.filter((p) => p.imagens.some((i) => i.problemas.length > 0) || p.proporcoesMisturadas || p.imagens.length === 0);
  if (filtro === "mistas") return produtos.filter((p) => p.proporcoesMisturadas);
  if (filtro === "sem-imagem") return produtos.filter((p) => p.imagens.length === 0);
  return produtos.filter((p) => p.imagens.some((i) => i.problemas.includes(filtro)));
}

export default async function ImagensPage({ searchParams }: { searchParams: Promise<{ filtro?: string; page?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const store = await getActiveStore();
  const filtro: Filtro = sp.filtro === "mistas" || sp.filtro === "sem-imagem" || PROBLEMAS.includes(sp.filtro as Problema) ? (sp.filtro as Filtro) : "todos";

  const produtos = store ? await auditarProdutos({ query }, store.id) : [];
  const resumo = resumirAuditoria(produtos);
  const lista = filtrar(produtos, filtro);
  const pages = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pages);
  const visiveis = lista.slice((page - 1) * POR_PAGINA, page * POR_PAGINA);
  const href = (f: Filtro, p = 1) => `/imagens?filtro=${f}${p > 1 ? `&page=${p}` : ""}`;

  const cartoes: { chave: Filtro | null; titulo: string; valor: number }[] = [
    { chave: null, titulo: "Imagens", valor: resumo.imagens },
    { chave: null, titulo: "No padrão", valor: resumo.noPadrao },
    { chave: "pequena", titulo: "Pequenas (< 800 px)", valor: resumo.porProblema.pequena },
    { chave: "proporcao", titulo: "Fora de 1:1 e 4:5", valor: resumo.porProblema.proporcao },
    { chave: "pesada", titulo: "Pesadas (> 600 KB)", valor: resumo.porProblema.pesada },
    { chave: "formato", titulo: "Não são JPEG", valor: resumo.porProblema.formato },
    { chave: "mistas", titulo: "Produtos com proporções misturadas", valor: resumo.proporcoesMisturadas },
    { chave: "sem-imagem", titulo: "Produtos sem imagem", valor: resumo.semImagem },
  ];

  return (
    <main className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Imagens</h1>
        <p className="text-sm text-muted">
          Auditoria das fotos atuais em relação ao padrão (lado maior 1024 px, 1:1 para peças e 4:5 para modelo, até ~600 KB, JPEG). Esta tela só lê: não altera nada na loja.
        </p>
      </div>

      <Card className="flex flex-col gap-3">
        <p className="text-sm">
          {resumo.medidas} de {resumo.imagens} imagens analisadas. A análise baixa cada foto da loja para medir; leva alguns minutos para o catálogo todo e pode ser interrompida e retomada.
        </p>
        <AuditRunner total={resumo.imagens} medidas={resumo.medidas} />
      </Card>

      <Card className="flex flex-col gap-2">
        <p className="text-sm">Para padronizar as fotos já existentes guardamos uma cópia de cada original (permite desfazer). Esse teste confere se o armazenamento está ligado; não toca na loja.</p>
        <StorageCheck />
      </Card>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cartoes.map((c) => {
          const corpo = (
            <>
              <span className="text-2xl font-semibold">{c.valor}</span>
              <span className="text-xs text-muted">{c.titulo}</span>
            </>
          );
          return (
            <li key={c.titulo}>
              {c.chave ? (
                <Link href={href(c.chave)} className={`flex h-full flex-col rounded-md border bg-card p-3 hover:bg-border/40 ${filtro === c.chave ? "border-primary" : "border-border"}`}>
                  {corpo}
                </Link>
              ) : (
                <div className="flex h-full flex-col rounded-md border border-border bg-card p-3">{corpo}</div>
              )}
            </li>
          );
        })}
      </ul>

      <nav aria-label="Filtro" className="flex flex-wrap gap-2 text-sm">
        {(["todos", ...PROBLEMAS, "mistas", "sem-imagem"] as Filtro[]).map((f) => (
          <Link key={f} href={href(f)} aria-current={filtro === f ? "page" : undefined} className={`rounded-full border px-3 py-1 ${filtro === f ? "border-primary bg-primary text-primary-foreground" : "border-border-strong hover:bg-border/40"}`}>
            {f === "todos" ? "Com algum problema" : f === "mistas" ? "Proporções misturadas" : f === "sem-imagem" ? "Sem imagem" : PROBLEMA_LABEL[f]}
          </Link>
        ))}
      </nav>

      {lista.length === 0 ? (
        <EmptyState title={resumo.medidas === 0 ? "Nenhuma imagem analisada ainda" : "Nada neste filtro"}>
          <p className="text-muted">{resumo.medidas === 0 ? "Clique em “Analisar imagens” para começar." : "Nenhum produto com este problema."}</p>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {visiveis.map((p) => (
            <li key={p.id}>
              <Card className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/produtos/${p.id}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  <span className="flex gap-2">
                    {p.proporcoesMisturadas && <Badge tone="warning">Proporções misturadas</Badge>}
                    {p.imagens.length === 0 && <Badge tone="danger">Sem imagem</Badge>}
                  </span>
                </div>
                {p.imagens.length > 0 && (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {p.imagens.map((i, n) => (
                      <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={i.src} alt="" width={40} height={40} loading="lazy" className="h-10 w-10 rounded border border-border object-cover" />
                        <span className="w-6 text-muted">#{i.position ?? n + 1}</span>
                        <span>{i.medida?.width ? `${i.medida.width}×${i.medida.height}` : "—"}</span>
                        <span>{proporcaoTexto(i.medida?.width ?? null, i.medida?.height ?? null)}</span>
                        <span>{kb(i.medida?.bytes ?? null)}</span>
                        <span className="flex flex-wrap gap-1">
                          {!i.medida ? <Badge>Não analisada</Badge> : i.problemas.length === 0 ? <Badge tone="success">No padrão</Badge> : i.problemas.map((pr) => <Badge key={pr} tone={pr === "erro" ? "danger" : "warning"}>{PROBLEMA_LABEL[pr]}</Badge>)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pages={pages} href={(p) => href(filtro, p)} />
    </main>
  );
}
