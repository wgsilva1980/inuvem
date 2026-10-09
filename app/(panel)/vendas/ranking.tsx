import Link from "next/link";

export interface LinhaRanking {
  chave: string;
  nome: string;
  /** Valor usado para o tamanho da barra. */
  valor: number;
  /** Texto à direita (o número, escrito). */
  texto: string;
  href?: string;
  foto?: string | null;
  detalhe?: string | null;
}

/** Lista com barras horizontais proporcionais ao maior valor. Os números estão escritos em cada linha (a barra só reforça). */
export function Ranking({ linhas, vazio = "Nenhuma venda neste período." }: { linhas: LinhaRanking[]; vazio?: string }) {
  if (linhas.length === 0) return <p className="text-sm text-muted">{vazio}</p>;
  const max = Math.max(...linhas.map((l) => l.valor), 1);
  return (
    <ol className="flex flex-col gap-2">
      {linhas.map((l, i) => (
        <li key={l.chave} className="flex items-center gap-3 text-sm">
          <span className="w-5 shrink-0 text-right text-xs text-muted">{i + 1}</span>
          {l.foto !== undefined &&
            (l.foto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.foto} alt="" width={40} height={40} loading="lazy" className="h-10 w-10 shrink-0 rounded border border-border object-cover" />
            ) : (
              <span className="h-10 w-10 shrink-0 rounded border border-border" aria-hidden />
            ))}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              {l.href ? (
                <Link href={l.href} className="truncate font-medium hover:underline">
                  {l.nome}
                </Link>
              ) : (
                <span className="truncate font-medium">{l.nome}</span>
              )}
              <span className="shrink-0 text-xs text-muted">{l.texto}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-border/60" aria-hidden>
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, Math.round((l.valor / max) * 100))}%` }} />
            </div>
            {l.detalhe && <span className="text-xs text-muted">{l.detalhe}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
