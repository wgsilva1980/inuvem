import * as React from "react";

/** Estado vazio: diz o que aconteceu e, se houver, oferece o próximo passo. */
export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 p-6 text-sm">
      <p className="font-medium">{title}</p>
      {children}
    </div>
  );
}
