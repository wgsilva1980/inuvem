export type PageItem = number | "…";

/**
 * Páginas a mostrar na paginação numerada: sempre a primeira, a última e a atual com `around` vizinhas
 * de cada lado; os vãos viram "…" (e um vão de uma página só mostra a própria página, sem reticências).
 */
export function pageItems(current: number, total: number, around = 1): PageItem[] {
  if (total <= 1) return total === 1 ? [1] : [];
  const keep = new Set<number>([1, total]);
  for (let p = current - around; p <= current + around; p++) if (p >= 1 && p <= total) keep.add(p);
  const sorted = [...keep].sort((a, b) => a - b);
  const out: PageItem[] = [];
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && p - prev === 2) out.push(prev + 1);
    else if (prev !== undefined && p - prev > 2) out.push("…");
    out.push(p);
  });
  return out;
}
