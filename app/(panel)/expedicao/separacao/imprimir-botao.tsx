"use client";

import { Button } from "@/components/ui/button";

export function ImprimirBotao() {
  return (
    <Button type="button" onClick={() => window.print()}>
      Imprimir
    </Button>
  );
}
