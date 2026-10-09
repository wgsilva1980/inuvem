import Link from "next/link";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldClass } from "@/components/ui/field";
import { query } from "@/lib/db";
import { descontoBase, listarParados } from "@/lib/promotions/parados";
import { resumoVendas } from "@/lib/sales/sync";
import { getActiveStore } from "@/lib/stores";
import { LiquidarForm } from "./liquidar-form";
import { SincronizarVendas } from "./sincronizar-vendas";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  dias: z.coerce.number().int().min(15).max(730).catch(90),
  estoque: z.coerce.number().int().min(1).max(100000).catch(1),
  publicados: z.enum(["1", "0"]).catch("1"),
});

const LIMITE = 200;

export default async function LiquidarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const store = await getActiveStore();
  if (!store) {
    return (
      <Card>
        <p className="text-sm text-muted">Conecte a loja na página inicial primeiro.</p>
      </Card>
    );
  }
  const sp = paramsSchema.parse(await searchParams);
  const db = { query };
  const resumo = await resumoVendas(db, store.id);
  const parados = resumo.janelaDias
    ? await listarParados(db, store.id, { dias: Math.min(sp.dias, resumo.janelaDias), minEstoque: sp.estoque, apenasPublicados: sp.publicados === "1", janelaDias: resumo.janelaDias, limit: LIMITE })
    : null;

  return (
    <main className="flex max-w-5xl flex-col gap-4 pb-20">
      <div className="flex flex-col gap-1">
        <Link href="/promocoes" className="text-sm text-muted hover:underline">
          ← Promoções
        </Link>
        <h1 className="text-xl font-semibold">Liquidar os parados</h1>
        <p className="text-sm text-muted">Produtos com estoque que não vendem há tempo. A IA sugere o desconto de cada um e você aprova, ajusta e agenda como uma promoção.</p>
      </div>

      <Card>
        <SincronizarVendas ultima={resumo.sincronizadoEm} janelaDias={resumo.janelaDias} />
      </Card>

      {parados === null ? (
        <Card>
          <p className="text-sm text-muted">Leia as vendas da loja para descobrir o que está parado. É só leitura: nada é alterado na loja.</p>
        </Card>
      ) : (
        <>
          <Card>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Sem vender há (dias)</span>
                <input name="dias" type="number" min={15} max={Math.min(730, resumo.janelaDias ?? 730)} defaultValue={sp.dias} className={`${fieldClass} w-28`} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Estoque mínimo</span>
                <input name="estoque" type="number" min={1} defaultValue={sp.estoque} className={`${fieldClass} w-28`} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Produtos</span>
                <select name="publicados" defaultValue={sp.publicados} className={fieldClass}>
                  <option value="1">Só publicados</option>
                  <option value="0">Todos</option>
                </select>
              </label>
              <button type="submit" className={buttonClass("primary")}>
                Filtrar
              </button>
            </form>
          </Card>

          <Card>
            {parados.itens.length === 0 ? (
              <p className="text-sm text-muted">Nenhum produto com estoque parado há {sp.dias} dias ou mais. Reduza os dias ou o estoque mínimo.</p>
            ) : (
              <>
                <p className="mb-3 text-sm text-muted">
                  {parados.total} {parados.total === 1 ? "produto parado" : "produtos parados"}
                  {parados.total > LIMITE ? ` (mostrando os ${LIMITE} com mais dinheiro parado)` : ""}. Ficam de fora os cadastrados há menos de {sp.dias} dias e os que já estão em outra promoção.
                </p>
                <LiquidarForm
                  key={`${sp.dias}-${sp.estoque}-${sp.publicados}-${resumo.sincronizadoEm}`}
                  filtros={{ dias: Math.min(sp.dias, resumo.janelaDias ?? sp.dias), minEstoque: sp.estoque, apenasPublicados: sp.publicados === "1" }}
                  linhas={parados.itens.map((p) => ({
                    id: p.id,
                    name: p.name,
                    published: p.published,
                    estoque: p.estoque,
                    precoMin: p.precoMin,
                    precoMax: p.precoMax,
                    jaEmPromocao: p.jaEmPromocao,
                    vendidas: p.vendidas,
                    diasParado: p.diasParado,
                    nuncaVendeu: p.ultimaVenda === null,
                    valorParado: p.valorParado,
                    base: descontoBase(p),
                  }))}
                />
              </>
            )}
          </Card>
        </>
      )}
    </main>
  );
}
