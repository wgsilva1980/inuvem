import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { relatorioDeQualidade, faixaDaNota, FAIXAS, type Duplicado, type Faixa, type RefProduto } from "@/lib/catalog/qualidade";
import { camposCorrigiveis } from "@/lib/catalog/corrigir";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { CorrigirQualidade } from "./corrigir";

export const dynamic = "force-dynamic";

const LIMITE = 50;
const COR: Record<Faixa, "success" | "warning" | "danger" | "neutral"> = { otimo: "success", bom: "success", regular: "warning", fraco: "danger" };

function ListaRefs({ itens }: { itens: RefProduto[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1 text-sm">
      {itens.slice(0, 8).map((p) => (
        <li key={p.id}>
          <Link href={`/produtos/${p.id}`} className="underline">
            {p.nome}
          </Link>
        </li>
      ))}
      {itens.length > 8 && <li className="text-muted">e mais {itens.length - 8}</li>}
    </ul>
  );
}

function ListaDuplicados({ itens, rotulo }: { itens: Duplicado[]; rotulo: string }) {
  return (
    <ul className="mt-2 flex flex-col gap-2 text-sm">
      {itens.slice(0, 6).map((d) => (
        <li key={d.valor}>
          <span className="font-medium">
            {rotulo} {d.valor}
          </span>
          <span className="text-muted"> em </span>
          {d.produtos.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              <Link href={`/produtos/${p.id}`} className="underline">
                {p.nome}
              </Link>
            </span>
          ))}
        </li>
      ))}
      {itens.length > 6 && <li className="text-muted">e mais {itens.length - 6}</li>}
    </ul>
  );
}

export default async function QualidadePage({ searchParams }: { searchParams: Promise<{ filtro?: string; publicados?: string }> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para ver a qualidade do catálogo.</p>
      </Card>
    );
  }
  const sp = await searchParams;
  // Padrão: só os produtos publicados. “Todos os produtos” vem de ?publicados=0.
  const soPublicados = !/^(0|false|nao|não)$/i.test(sp.publicados ?? "");
  const r = await relatorioDeQualidade({ query }, store.id, { soPublicados });
  if (r.produtos.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">
          {r.foraDoFiltro > 0 ? (
            <>
              Nenhum produto publicado no catálogo.{" "}
              <Link href="/qualidade?publicados=0" className="underline">
                Ver todos os produtos
              </Link>
              .
            </>
          ) : (
            "O catálogo ainda não foi sincronizado. Sincronize os produtos na página inicial."
          )}
        </p>
      </Card>
    );
  }
  const filtro = sp.filtro;
  const href = (chave?: string) => {
    const q = new URLSearchParams();
    if (chave) q.set("filtro", chave);
    if (!soPublicados) q.set("publicados", "0");
    const s = q.toString();
    return `/qualidade${s ? `?${s}` : ""}`;
  };
  const pill = (ativo: boolean) => `rounded-full border px-3 py-1 ${ativo ? "border-primary bg-primary text-primary-foreground" : "border-border-strong hover:bg-border/40"}`;
  const problemaEscolhido = r.porProblema.find((p) => p.chave === filtro);
  const lista = (problemaEscolhido ? r.produtos.filter((p) => p.problemas.some((x) => x.chave === problemaEscolhido.chave)) : r.produtos.filter((p) => p.problemas.length > 0)).slice(0, LIMITE);
  const total = problemaEscolhido ? problemaEscolhido.produtos : r.produtos.filter((p) => p.problemas.length > 0).length;
  const corrigiveis = lista.map((p) => ({ id: p.id, nome: p.nome, campos: camposCorrigiveis(p.problemas.map((x) => x.chave)) })).filter((p) => p.campos.length > 0);
  const c = r.cruzadas;
  const temCruzadas = c.skusRepetidos.length + c.nomesRepetidos.length + c.promocaoSemDesconto.length + c.precosMuitoDiferentes.length + c.prontosNaoPublicados.length > 0;

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Qualidade do catálogo</h1>
        <p className="text-sm text-muted">
          {soPublicados ? "Só os produtos publicados entram nas notas e nas listas. " : ""}Cada produto recebe uma nota de 0 a 100 pelas mesmas verificações do checklist da página do produto: os itens obrigatórios (foto, preço, categoria, descrição, estoque) pesam o triplo dos recomendados (mais fotos, SEO, SKU, peso e medidas, tags…). Calculado do que o painel já sincronizou. Descrição, SEO e tags podem ser escritos com a IA em “Corrigir com a IA”, com revisão antes de gravar.
        </p>
      </div>

      <nav aria-label="Produtos considerados" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Mostrar:</span>
        <Link href={filtro ? `/qualidade?filtro=${encodeURIComponent(filtro)}` : "/qualidade"} aria-current={soPublicados ? "page" : undefined} className={pill(soPublicados)}>
          Só produtos publicados
        </Link>
        <Link href={filtro ? `/qualidade?filtro=${encodeURIComponent(filtro)}&publicados=0` : "/qualidade?publicados=0"} aria-current={!soPublicados ? "page" : undefined} className={pill(!soPublicados)}>
          Todos os produtos
        </Link>
        {soPublicados && r.foraDoFiltro > 0 && <span className="text-xs text-muted">{r.foraDoFiltro} não publicado(s) fora desta visão</span>}
      </nav>

      <section aria-label="Resumo" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="flex flex-col gap-1">
          <span className="text-xs text-muted">Nota média</span>
          <span className="text-2xl font-semibold">{r.notaMedia}</span>
        </Card>
        <Card className="flex flex-col gap-1">
          <span className="text-xs text-muted">Produtos</span>
          <span className="text-2xl font-semibold">{r.produtos.length}</span>
        </Card>
        <Card className="flex flex-col gap-1">
          <span className="text-xs text-muted">Prontos para a vitrine</span>
          <span className="text-2xl font-semibold">
            {r.prontos} <span className="text-sm font-normal text-muted">de {r.produtos.length}</span>
          </span>
        </Card>
        <Card className="flex flex-col gap-1">
          <span className="text-xs text-muted">Por faixa de nota</span>
          <ul className="text-sm">
            {FAIXAS.map((f) => (
              <li key={f.faixa} className="flex justify-between gap-2">
                <span>{f.rotulo}</span>
                <span className="font-medium">{r.porFaixa[f.faixa]}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <Card className="flex flex-col gap-3">
        <h2 className="font-medium">O que mais falta</h2>
        {r.porProblema.length === 0 ? (
          <p className="text-sm text-success">Nenhuma pendência: todos os produtos cumprem todas as verificações.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {r.porProblema.map((p) => (
              <li key={p.chave}>
                <Link href={href(p.chave)} aria-current={problemaEscolhido?.chave === p.chave ? "true" : undefined} className={`flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2 hover:bg-border/40 ${problemaEscolhido?.chave === p.chave ? "border-foreground" : "border-border-strong"}`}>
                  <span>
                    {p.rotulo}
                    {p.obrigatorio && <span className="text-danger"> · obrigatório</span>}
                  </span>
                  <Badge tone={p.obrigatorio ? "danger" : "warning"}>{p.produtos}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {temCruzadas && (
        <Card className="flex flex-col gap-4">
          <h2 className="font-medium">Entre produtos</h2>
          {c.prontosNaoPublicados.length > 0 && (
            <div>
              <p className="text-sm font-medium">
                Prontos e não publicados ({c.prontosNaoPublicados.length}) <span className="font-normal text-muted">— cumprem todos os obrigatórios; é só publicar.</span>
              </p>
              <ListaRefs itens={c.prontosNaoPublicados} />
            </div>
          )}
          {c.skusRepetidos.length > 0 && (
            <div>
              <p className="text-sm font-medium">
                SKUs repetidos ({c.skusRepetidos.length}) <span className="font-normal text-muted">— o mesmo SKU em mais de uma variação atrapalha estoque e pedidos.</span>
              </p>
              <ListaDuplicados itens={c.skusRepetidos} rotulo="SKU" />
            </div>
          )}
          {c.nomesRepetidos.length > 0 && (
            <div>
              <p className="text-sm font-medium">
                Nomes repetidos ({c.nomesRepetidos.length}) <span className="font-normal text-muted">— podem ser cadastros duplicados.</span>
              </p>
              <ListaDuplicados itens={c.nomesRepetidos} rotulo="Nome" />
            </div>
          )}
          {c.promocaoSemDesconto.length > 0 && (
            <div>
              <p className="text-sm font-medium">
                Preço promocional igual ou maior que o preço ({c.promocaoSemDesconto.length}) <span className="font-normal text-muted">— a promoção não dá desconto.</span>
              </p>
              <ListaRefs itens={c.promocaoSemDesconto} />
            </div>
          )}
          {c.precosMuitoDiferentes.length > 0 && (
            <div>
              <p className="text-sm font-medium">
                Variações com preços muito diferentes ({c.precosMuitoDiferentes.length}) <span className="font-normal text-muted">— a mais cara custa mais de 3 vezes a mais barata; pode ser erro de digitação.</span>
              </p>
              <ListaRefs itens={c.precosMuitoDiferentes} />
            </div>
          )}
        </Card>
      )}

      <CorrigirQualidade key={`${problemaEscolhido?.chave ?? "todos"}|${soPublicados}`} itens={corrigiveis} />

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">{problemaEscolhido ? `Produtos com “${problemaEscolhido.rotulo}” pendente` : "Produtos com pendências, dos piores para os melhores"}</h2>
          {problemaEscolhido && (
            <Link href={href()} className="text-sm underline">
              Ver todos
            </Link>
          )}
        </div>
        {lista.length === 0 ? (
          <p className="text-sm text-success">Nenhum produto com pendências.</p>
        ) : (
          <ul className="divide-y divide-border">
            {lista.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/produtos/${p.id}`} className="font-medium underline">
                    {p.nome}
                  </Link>
                  <span className="flex items-center gap-2">
                    {!p.publicado && <Badge tone="neutral">Não publicado</Badge>}
                    <Badge tone={COR[faixaDaNota(p.nota)]}>{p.nota}</Badge>
                  </span>
                </div>
                <ul className="flex flex-col gap-0.5 text-muted">
                  {p.problemas.map((x) => (
                    <li key={x.chave}>
                      <span className={x.obrigatorio ? "text-danger" : ""}>{x.rotulo}</span>: {x.detalhe}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {total > LIMITE && <p className="text-xs text-muted">Mostrando os {LIMITE} piores de {total}. Corrija os primeiros e a lista avança.</p>}
      </Card>
    </main>
  );
}
