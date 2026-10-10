import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { query } from "@/lib/db";
import { NuvemshopError } from "@/lib/nuvemshop";
import { sugestoesDe, type ItemParaSeo, type SugestaoGuardada, type TipoItem } from "@/lib/seo/item";
import { carregarItens } from "@/lib/seo/item-service";
import { getActiveStore } from "@/lib/stores";
import { ItemEditor } from "./item-editor";
import { ItensRunners } from "./itens-runners";
import { SeoTabs } from "./seo-tabs";

type Filtro = "revisar" | "sem-seo" | "aplicados" | "erros" | "todos";
const FILTROS: Array<[Filtro, string]> = [
  ["revisar", "Para revisar"],
  ["sem-seo", "Sem SEO na loja"],
  ["aplicados", "Já gravados"],
  ["erros", "Com erro"],
  ["todos", "Todos"],
];

interface Linha {
  item: ItemParaSeo;
  s: SugestaoGuardada | undefined;
  igual: boolean;
}

const TEXTO = {
  categoria: {
    titulo: "SEO das categorias",
    aba: "/seo/categorias" as const,
    plural: "categorias",
    explica: "O Claude escreve, para cada categoria, o título de SEO (até 70 caracteres, terminando em “| Donatelle Concept”) e a descrição de SEO (até 320), usando o nome, a descrição atual e exemplos dos produtos que ela tem. Gerar não altera a loja; você revisa, edita se quiser e só então grava.",
  },
  pagina: {
    titulo: "SEO das páginas",
    aba: "/seo/paginas" as const,
    plural: "páginas",
    explica: "O Claude escreve, para cada página da loja (Sobre nós, Trocas…), o título e a descrição de SEO fiéis ao conteúdo dela. As páginas são lidas da loja na hora. Gerar não altera a loja; você revisa, edita se quiser e só então grava.",
  },
};

/** Tela de SEO de categorias ou páginas (mesmo fluxo do SEO de produtos: gerar, revisar, gravar). */
export async function ItensView({ tipo, filtro: filtroParam }: { tipo: TipoItem; filtro?: string }) {
  const store = await getActiveStore();
  const t = TEXTO[tipo];
  const filtro = (FILTROS.map((f) => f[0]) as string[]).includes(filtroParam ?? "") ? (filtroParam as Filtro) : "revisar";
  const configurado = Boolean(process.env.ANTHROPIC_API_KEY);

  let itens: ItemParaSeo[] = [];
  let erro: string | null = null;
  if (store) {
    try {
      itens = await carregarItens(store, tipo);
    } catch (err) {
      erro = err instanceof NuvemshopError ? err.userMessage : "Não foi possível ler os dados da loja agora.";
    }
  }
  const sugestoes = store ? await sugestoesDe({ query }, store.id, tipo) : new Map<string, SugestaoGuardada>();
  const linhas: Linha[] = itens.map((item) => {
    const s = sugestoes.get(item.id);
    return { item, s, igual: Boolean(s?.titulo && s.titulo === item.seoTituloAtual && s.descricao === item.seoDescricaoAtual) };
  });
  const temSug = (l: Linha) => Boolean(l.s?.titulo && l.s.descricao && !l.s.erro);
  const semSeo = (l: Linha) => l.item.seoTituloAtual === "" || l.item.seoDescricaoAtual === "";
  const lista = linhas.filter((l) => {
    switch (filtro) {
      case "sem-seo":
        return temSug(l) && semSeo(l);
      case "aplicados":
        return l.s?.aplicado;
      case "erros":
        return Boolean(l.s?.erro);
      case "todos":
        return true;
      default:
        return temSug(l) && !l.s?.aplicado && !l.igual;
    }
  });
  const gravaveis = linhas.filter((l) => temSug(l) && !l.s?.aplicado && !l.igual);

  return (
    <main className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t.titulo}</h1>
        <p className="text-sm text-muted">{t.explica}</p>
      </div>
      <SeoTabs atual={t.aba} />

      {!configurado && (
        <Card className="text-sm">
          <p className="font-medium">Falta configurar a chave da API da Anthropic.</p>
          <p className="text-muted">Cadastre <code>ANTHROPIC_API_KEY</code> na Vercel (Settings → Environment Variables) e faça um novo deploy.</p>
        </Card>
      )}
      {erro && (
        <Card className="text-sm">
          <p role="alert" className="text-danger">{erro}</p>
          {tipo === "pagina" && <p className="text-muted">Se for falta de permissão, o app precisa ser reautorizado com acesso às páginas (conteúdo) da loja.</p>}
        </Card>
      )}

      {store && !erro && tipo === "pagina" && linhas.length === 0 && (
        <Card className="text-sm">
          <p className="font-medium">A loja não devolveu nenhuma página.</p>
          <p className="text-muted">
            Se você tem páginas (Quem somos, Política de privacidade…) e elas não aparecem, é provável que a Nuvemshop não as exponha por esta API (por exemplo, páginas feitas no editor do tema). Rode o <a href="/diagnostico" className="underline">Diagnóstico da API</a> e veja a linha “Páginas da loja”: ela mostra o que a loja respondeu.
          </p>
        </Card>
      )}

      {store && !erro && (
        <Card className="flex flex-col gap-3">
          <p className="text-sm">
            {linhas.length} {t.plural}; {linhas.filter((l) => temSug(l)).length} com SEO gerado, {linhas.filter((l) => l.s?.aplicado).length} já gravadas na loja, {linhas.filter(semSeo).length} hoje sem título ou sem descrição de SEO.
          </p>
          <ItensRunners
            tipo={tipo}
            idsGerar={linhas.filter((l) => !temSug(l)).map((l) => l.item.id)}
            idsTodos={linhas.map((l) => l.item.id)}
            idsGravar={gravaveis.map((l) => l.item.id)}
            idsGravarVazios={gravaveis.filter((l) => l.item.seoTituloAtual === "" && l.item.seoDescricaoAtual === "").map((l) => l.item.id)}
          />
        </Card>
      )}

      <nav aria-label="Filtro" className="flex flex-wrap gap-2 text-sm">
        {FILTROS.map(([f, rotulo]) => (
          <Link key={f} href={`${t.aba}?filtro=${f}`} aria-current={filtro === f ? "page" : undefined} className={`rounded-full border px-3 py-1 ${filtro === f ? "border-primary bg-primary text-primary-foreground" : "border-border-strong hover:bg-border/40"}`}>
            {rotulo}
          </Link>
        ))}
      </nav>

      {lista.length === 0 ? (
        <EmptyState title={linhas.some(temSug) ? "Nada neste filtro" : "Nenhum SEO gerado ainda"}>
          <p className="text-muted">{linhas.some(temSug) ? `Nenhuma ${tipo === "pagina" ? "página" : "categoria"} com este filtro.` : "Use “Gerar para quem falta” para começar."}</p>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {lista.map(({ item, s }) => (
            <li key={item.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.nome}</span>
                  {s?.aplicado && <Badge tone="success">Gravado na loja</Badge>}
                  {s?.aviso && <Badge tone="warning">Confira: {s.aviso}</Badge>}
                  {s?.erro && <Badge tone="danger">Erro ao gerar</Badge>}
                </div>
                {s?.erro && <p className="text-sm text-danger">{s.erro}</p>}
                <div className="rounded border border-border p-2 text-xs text-muted">
                  <p className="font-medium">Hoje na loja</p>
                  <p>Título: {item.seoTituloAtual || <em>(vazio)</em>}</p>
                  <p>Descrição: {item.seoDescricaoAtual || <em>(vazia)</em>}</p>
                </div>
                {s?.titulo && s.descricao && !s.erro && <ItemEditor key={`${s.titulo}|${s.descricao}`} tipo={tipo} itemId={Number(item.id)} titulo={s.titulo} descricao={s.descricao} aplicado={s.aplicado} />}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
