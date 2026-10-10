import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { relatorioDeQualidade, faixaDaNota, FAIXAS, type Duplicado, type Faixa, type RefProduto } from "@/lib/catalog/qualidade";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";

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

export default async function QualidadePage({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial para ver a qualidade do catálogo.</p>
      </Card>
    );
  }
  const r = await relatorioDeQualidade({ query }, store.id);
  if (r.produtos.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">O catálogo ainda não foi sincronizado. Sincronize os produtos na página inicial.</p>
      </Card>
    );
  }
  const filtro = (await searchParams).filtro;
  const problemaEscolhido = r.porProblema.find((p) => p.chave === filtro);
  const lista = (problemaEscolhido ? r.produtos.filter((p) => p.problemas.some((x) => x.chave === problemaEscolhido.chave)) : r.produtos.filter((p) => p.problemas.length > 0)).slice(0, LIMITE);
  const total = problemaEscolhido ? problemaEscolhido.produtos : r.produtos.filter((p) => p.problemas.length > 0).length;
  const c = r.cruzadas;
  const temCruzadas = c.skusRepetidos.length + c.nomesRepetidos.length + c.promocaoSemDesconto.length + c.precosMuitoDiferentes.length + c.prontosNaoPublicados.length > 0;

  return (
    <main className="flex max-w-4xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Qualidade do catálogo</h1>
        <p className="text-sm text-muted">
          Cada produto recebe uma nota de 0 a 100 pelas mesmas verificações do checklist da página do produto: os itens obrigatórios (foto, preço, categoria, descrição, estoque) pesam o triplo dos recomendados (mais fotos, SEO, SKU, peso e medidas, tags…). Calculado do que o painel já sincronizou; nada é alterado na loja.
        </p>
      </div>

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
                <Link href={`/qualidade?filtro=${p.chave}`} aria-current={problemaEscolhido?.chave === p.chave ? "true" : undefined} className={`flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2 hover:bg-border/40 ${problemaEscolhido?.chave === p.chave ? "border-foreground" : "border-border-strong"}`}>
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

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">{problemaEscolhido ? `Produtos com “${problemaEscolhido.rotulo}” pendente` : "Produtos com pendências, dos piores para os melhores"}</h2>
          {problemaEscolhido && (
            <Link href="/qualidade" className="text-sm underline">
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
