/** Marca do painel: monograma + nome. Mesmo visual no login e no cabeçalho. */
export function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold ${className}`.trim()}>
      <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
        I
      </span>
      INuvem
    </span>
  );
}
