import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { autoOcultarCategoriasLigado, planejarCategorias, ultimasAcoesCategorias, ACAO_EXIBIR } from "@/lib/automations/categorias";
import { autoRepublicarLigado, listarAguardandoEstoque } from "@/lib/automations/in-stock";
import { autoDespublicarLigado, contarPublicadosSemEstoque, ultimasAcoesAutomaticas } from "@/lib/automations/out-of-stock";
import { query } from "@/lib/db";
import { NOME_ARQUIVO, listaOculta } from "@/lib/menu/arquivo";
import { lerConfigFtp } from "@/lib/menu/ftp";
import { estadoDoMenu, menuAutomaticoLigado } from "@/lib/menu/service";
import { getActiveStore } from "@/lib/stores";
import { AutomacaoForm } from "./automacao-form";
import { MenuArquivoAcoes, MenuArquivoForm } from "./menu-arquivo";
import { CategoriasVaziasAgora, CategoriasVaziasForm } from "./categorias-vazias";
import { AguardandoEstoque } from "./aguardando-estoque";
import { DespublicarAgora } from "./despublicar-agora";
import { RepublicarForm } from "./republicar-form";

export const dynamic = "force-dynamic";

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export default async function AutomacoesPage() {
  await requireAdmin();
  const store = await getActiveStore();
  const db = { query };
  const ligado = store ? await autoDespublicarLigado(db, store.id) : false;
  const semEstoque = store ? await contarPublicadosSemEstoque(db, store.id) : 0;
  const republicar = store ? await autoRepublicarLigado(db, store.id) : false;
  const espera = store ? await listarAguardandoEstoque(db, store.id) : [];
  const acoes = store ? await ultimasAcoesAutomaticas(db, store.id) : [];
  const catLigada = store ? await autoOcultarCategoriasLigado(db, store.id) : false;
  const plano = store ? await planejarCategorias(db, store.id) : null;
  const ftp = lerConfigFtp();
  const menuLigado = store ? await menuAutomaticoLigado(db, store.id) : false;
  const menu = store ? await estadoDoMenu(db, store.id) : null;
  const ocultas = store ? await listaOculta(db, store.id) : null;
  const acoesCat = store ? await ultimasAcoesCategorias(db, store.id) : [];

  return (
    <main className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Automações</h1>
        <p className="text-sm text-muted">Regras que o painel aplica sozinho quando a Nuvemshop avisa de uma mudança. Cada ação automática aparece no Histórico.</p>
      </div>

      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Produto sem estoque sai da loja</h2>
        <AutomacaoForm ligado={ligado} />
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Só despublica quando <strong>todas</strong> as variações têm controle de estoque e estoque zero. Se qualquer variação tiver estoque ou não controlar estoque (ilimitado), o produto fica como está.</li>
          <li>Muda só o campo “Publicado na loja” para falso. O produto continua no painel e dá para publicar de novo quando houver estoque.</li>
          <li>Para o produto voltar sozinho quando o estoque voltar, use a regra logo abaixo.</li>
          <li>Se você publicar de propósito um produto sem estoque (por exemplo, sob encomenda), a regra o despublicará na próxima atualização dele. Nesse caso, deixe a regra desligada.</li>
          <li>A regra age quando chega um aviso do produto. Produtos que já estão publicados sem estoque hoje só são despublicados quando receberem uma atualização; para tirá-los agora, use o botão abaixo.</li>
        </ul>
        <p className="text-sm">
          Agora há <strong>{semEstoque}</strong> produto(s) publicado(s) com todas as variações sem estoque.
        </p>
        <DespublicarAgora quantos={semEstoque} />
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Produto volta à loja quando o estoque volta</h2>
        <RepublicarForm ligado={republicar} />
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Só volta o produto que <strong>a regra acima despublicou</strong>. Produtos que você despublicou por conta própria nunca são publicados por esta regra.</li>
          <li>Volta quando pelo menos uma variação tiver estoque (ou deixar de controlar estoque). Quem você marcar como “Manter despublicado” fica fora.</li>
          <li>Se você publicar o produto à mão, ele sai da lista de espera.</li>
        </ul>
        <h3 className="text-sm font-semibold">Despublicados por falta de estoque ({espera.length})</h3>
        <AguardandoEstoque linhas={espera.map((e) => ({ product_id: e.product_id, produto: e.produto ?? `Produto ${e.product_id}`, desde: e.desde, manter: e.manter, comEstoque: e.comEstoque }))} />
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Categoria sem produto publicado fica oculta</h2>
        <CategoriasVaziasForm ligado={catLigada} />
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Uma categoria só é oculta quando <strong>nenhum produto publicado</strong> está nela nem em suas subcategorias. Uma categoria pai com subcategorias que têm produto continua visível.</li>
          <li>Muda só a visibilidade da categoria na loja (ela some do menu e da vitrine). Os produtos, o nome e o endereço continuam como estão.</li>
          <li>Quando volta um produto publicado (ou a categoria recebe um produto), ela é mostrada de novo. <strong>Só volta sozinha a categoria que esta regra ocultou</strong>: as que você ocultou por conta própria (como uma de Black Friday) nunca são mostradas pela regra.</li>
          <li>Em <Link href="/categorias" className="underline">Categorias</Link> você pode ocultar ou mostrar qualquer categoria à mão. <strong>Mostrar à mão deixa a categoria “sempre visível”</strong>: a regra não a oculta mais, mesmo vazia, até você clicar em “Devolver à automação”. Ocultar à mão tira a categoria da regra (ela não volta sozinha).</li>
          <li>Categoria nova e ainda vazia também é ocultada na próxima verificação e aparece sozinha quando receber o primeiro produto publicado.</li>
          <li>Por segurança, oculta no máximo 5 categorias por vez e não faz nada se o painel não tiver nenhum produto publicado no espelho (sincronize o catálogo).</li>
        </ul>
        {plano?.espelhoSemProdutos ? (
          <p className="text-sm text-danger">O painel não tem nenhum produto publicado no espelho. Sincronize o catálogo antes de usar esta regra.</p>
        ) : plano ? (
          <div className="flex flex-col gap-1 text-sm">
            <p>
              Agora há <strong>{plano.ocultar.length}</strong> categoria(s) visível(is) sem produto publicado
              {plano.ocultar.length > 0 ? `: ${plano.ocultar.slice(0, 8).map((c) => c.nome).join(", ")}${plano.ocultar.length > 8 ? "…" : ""}` : ""}.
            </p>
            <p>
              A regra mantém <strong>{plano.ocultasPelaRegra.length + plano.exibir.length}</strong> categoria(s) oculta(s) por ela
              {plano.exibir.length > 0 ? `; ${plano.exibir.length} já tem(êm) produto de volta: ${plano.exibir.slice(0, 8).map((c) => c.nome).join(", ")}` : ""}.
            </p>
          </div>
        ) : null}
        <CategoriasVaziasAgora ocultar={plano?.ocultar.length ?? 0} exibir={plano?.exibir.length ?? 0} />
        {acoesCat.length > 0 && (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {acoesCat.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="text-muted">{quando(a.created_at)}</span>
                <span className="font-medium">{a.categoria}</span>
                {a.sucesso ? <Badge tone="success">{a.acao === ACAO_EXIBIR ? "Mostrada de novo" : "Ocultada"}</Badge> : <Badge tone="danger">Falhou</Badge>}
                {a.mensagem && <span className="text-danger">{a.mensagem}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Arquivo de menu da loja (envio por FTP)</h2>
        <p className="text-sm text-muted">
          O tema da loja esconde do menu as categorias listadas em <code>snipplets/navigation/{NOME_ARQUIVO}</code>. O painel gera esse arquivo com <strong>todas as categorias ocultas</strong> (as que a automação ocultou, as que você oculta à mão e as já ocultas na loja) e o envia por FTPS, sobrescrevendo o arquivo inteiro.
        </p>
        {!ftp.config ? (
          <p className="text-sm text-danger">Falta configurar o FTP na Vercel (Settings → Environment Variables): {ftp.faltando.join(", ")}. Veja as variáveis no README (item 98).</p>
        ) : (
          <p className="text-sm text-muted">
            FTP configurado: {ftp.config.host}:{ftp.config.port} ({ftp.config.secure === "implicit" ? "TLS implícito" : "TLS explícito"}), pasta <code>{ftp.config.dir}</code>.
          </p>
        )}
        <MenuArquivoForm ligado={menuLigado} configurado={ftp.config !== null} />
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Antes de gravar, o painel confere se a pasta tem o <code>navigation-top.tpl</code> (para não gravar na pasta errada), envia com o nome <code>{NOME_ARQUIVO}.tmp</code>, confere o tamanho e só então renomeia: a loja nunca lê um arquivo pela metade.</li>
          <li>Só envia quando o conteúdo mudou. A versão anterior fica guardada para voltar atrás. Depois de um envio, a loja pode levar alguns minutos para refletir (cache). Cada envio vai para o Histórico.</li>
          <li>Se o envio falhar, as tentativas automáticas esperam 5 minutos; o botão “Enviar agora” tenta na hora.</li>
        </ul>
        {ocultas && (
          <div className="flex flex-col gap-1 text-sm">
            <p>
              Hoje há <strong>{ocultas.caminhos.length}</strong> categoria(s) oculta(s) no arquivo{ocultas.caminhos.length > 0 ? `: ${ocultas.caminhos.slice(0, 10).join(", ")}${ocultas.caminhos.length > 10 ? "…" : ""}` : ""}.
            </p>
            {ocultas.descartadas.length > 0 && <p className="text-danger">Ficaram de fora, por não terem um endereço válido (só letras minúsculas, números e hífen): {ocultas.descartadas.join(", ")}.</p>}
            {menu?.enviadoEm ? <p className="text-muted">Último envio: {quando(menu.enviadoEm)}.</p> : <p className="text-muted">Nenhum envio feito ainda.</p>}
            {menu?.erro && <p className="text-danger">Última tentativa falhou ({menu.tentativaEm ? quando(menu.tentativaEm) : "—"}): {menu.erro}.</p>}
          </div>
        )}
        <MenuArquivoAcoes configurado={ftp.config !== null} temAnterior={menu?.anterior != null} />
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Últimas ações automáticas</h2>
        {acoes.length === 0 ? (
          <EmptyState title="Nenhuma ação automática ainda" />
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {acoes.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="text-muted">{quando(a.created_at)}</span>
                <Link href={`/produtos/${a.product_id}`} className="font-medium hover:underline">
                  {a.produto ?? `Produto ${a.product_id}`}
                </Link>
                {a.sucesso ? <Badge tone="success">{a.acao === "produto.republicar_com_estoque" ? "Publicado de novo" : "Despublicado"}</Badge> : <Badge tone="danger">Falhou</Badge>}
                {a.mensagem && <span className="text-danger">{a.mensagem}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
