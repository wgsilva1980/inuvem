import type { VendaDia } from "@/lib/orders/stats";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/** Barras de faturamento por dia (uma série, sem legenda: o título diz o que é). Tabela com os mesmos números logo abaixo. */
export function GraficoDias({ dias }: { dias: VendaDia[] }) {
  const max = Math.max(...dias.map((d) => d.faturamento), 0);
  const total = dias.reduce((s, d) => s + d.faturamento, 0);
  if (dias.length === 0 || total === 0) return <p className="text-sm text-muted">Nenhuma venda neste período.</p>;
  const passo = 12;
  const altura = 140;
  const largura = dias.length * passo;
  const arredondar = dias.length <= 90;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-xs text-muted">
        <span>{dataBr(dias[0]!.dia)}</span>
        <span>Maior dia: {brl(max)}</span>
        <span>{dataBr(dias.at(-1)!.dia)}</span>
      </div>
      <svg viewBox={`0 0 ${largura} ${altura}`} preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label={`Faturamento por dia, de ${dataBr(dias[0]!.dia)} a ${dataBr(dias.at(-1)!.dia)}; total ${brl(total)}`}>
        <line x1="0" y1={altura - 0.5} x2={largura} y2={altura - 0.5} className="stroke-border-strong" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {dias.map((d, i) => {
          const h = max > 0 ? Math.max(d.faturamento > 0 ? 2 : 0, (d.faturamento / max) * (altura - 4)) : 0;
          return (
            <rect key={d.dia} x={i * passo + 1} y={altura - 1 - h} width={passo - 2} height={h} rx={arredondar ? 2 : 0} className="fill-primary">
              <title>{`${dataBr(d.dia)}: ${brl(d.faturamento)} · ${d.pedidos} ${d.pedidos === 1 ? "pedido" : "pedidos"}`}</title>
            </rect>
          );
        })}
      </svg>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Ver como tabela</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="text-muted">
              <th className="py-1 font-medium">Dia</th>
              <th className="py-1 text-right font-medium">Pedidos</th>
              <th className="py-1 text-right font-medium">Faturamento</th>
            </tr>
          </thead>
          <tbody>
            {[...dias].reverse().map((d) => (
              <tr key={d.dia} className="border-t border-border">
                <td className="py-1">{dataBr(d.dia)}</td>
                <td className="py-1 text-right">{d.pedidos}</td>
                <td className="py-1 text-right">{brl(d.faturamento)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
