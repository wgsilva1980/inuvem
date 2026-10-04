import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { pageItems } from "@/lib/pagination";

/**
 * Paginação numerada: anterior/próxima + números (com reticências nos vãos). A página atual leva aria-current.
 * `href` monta o link de cada página, para manter filtros e ordenação.
 */
export function Pagination({
  page,
  pages,
  href,
  prevLabel = "Anterior",
  nextLabel = "Próxima",
}: {
  page: number;
  pages: number;
  href: (page: number) => string;
  prevLabel?: string;
  nextLabel?: string;
}) {
  if (pages <= 1) return null;
  const numberClass = (active: boolean) =>
    `inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border px-2 text-sm font-medium ${active ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-card hover:bg-border/40"}`;

  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className={buttonClass("outline")}>
          {prevLabel}
        </Link>
      ) : (
        <span />
      )}
      <ul className="order-last flex w-full flex-wrap items-center justify-center gap-1 sm:order-none sm:w-auto">
        {pageItems(page, pages).map((item, i) =>
          item === "…" ? (
            <li key={`gap-${i}`} aria-hidden="true" className="px-1 text-muted">
              …
            </li>
          ) : (
            <li key={item}>
              <Link href={href(item)} className={numberClass(item === page)} aria-current={item === page ? "page" : undefined} aria-label={`Página ${item} de ${pages}`}>
                {item}
              </Link>
            </li>
          ),
        )}
      </ul>
      {page < pages ? (
        <Link href={href(page + 1)} className={buttonClass("outline")}>
          {nextLabel}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
