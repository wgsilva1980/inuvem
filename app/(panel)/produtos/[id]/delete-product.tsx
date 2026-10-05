"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldClass } from "@/components/ui/field";
import { deleteProductAction, type SaveState } from "./actions";

/** Exclusão irreversível: só libera o botão depois de digitar o nome do produto. */
export function DeleteProduct({ productId, name }: { productId: number; name: string }) {
  const [state, action, pending] = useActionState<SaveState | null, FormData>(deleteProductAction.bind(null, productId), null);
  const [typed, setTyped] = useState("");
  return (
    <Card className="border-danger">
      <h2 className="text-base font-semibold text-danger">Excluir produto</h2>
      <p className="mt-1 text-sm text-muted">
        Remove o produto, as variantes e as imagens da Nuvemshop. Não dá para desfazer. Para só tirar da vitrine, desmarque “Publicado na loja”.
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-danger">Quero excluir este produto</summary>
        <form action={action} className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>
              Digite <strong>{name}</strong> para confirmar
            </span>
            <input name="confirm_name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className={fieldClass} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="danger" disabled={pending || typed.trim() !== name.trim()}>
              {pending ? "Excluindo…" : "Excluir produto"}
            </Button>
            {state?.message && (
              <span role="alert" className="text-sm text-danger">
                {state.message}
              </span>
            )}
          </div>
        </form>
      </details>
    </Card>
  );
}
