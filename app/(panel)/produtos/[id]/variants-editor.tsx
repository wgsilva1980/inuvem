"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ImageRow } from "@/lib/catalog/images";
import type { ProductDetail } from "@/lib/catalog/query";
import { saveVariant, type ActionState } from "./media-actions";
import { createProductVariant, deleteVariantAction, saveAttributes, type ManageState } from "./variant-actions";
import { fieldClass } from "@/components/ui/field";

const ptWeight = (value: string | null) => (value === null ? "" : String(Number(value)).replace(".", ","));
const ptMoney = (value: string | null) => (value === null ? "" : Number(value).toFixed(2).replace(".", ","));

type Variant = ProductDetail["variants"][number];

function VariantRow({
  productId,
  variant,
  images,
  attributes,
  canDelete,
}: {
  productId: number;
  variant: Variant;
  images: ImageRow[];
  attributes: string[];
  canDelete: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState | null, FormData>(saveVariant.bind(null, productId, Number(variant.id)), null);
  const err = (name: string) => state?.fieldErrors?.[name];
  const values = variant.values.map((x) => x.pt ?? Object.values(x).find((v) => v) ?? "");
  const label = values.filter(Boolean).join(" / ") || "Padrão";
  // `key` recria o formulário com os valores novos quando o espelho muda (conflito ou salvamento).
  const key = `${variant.sku}|${variant.price}|${variant.promotional_price}|${variant.stock}|${variant.stock_management}|${variant.image_id}|${variant.weight}|${values.join("¦")}`;
  const [deleting, startDelete] = useTransition();
  const [deleteMessage, setDeleteMessage] = useState<ManageState | null>(null);

  return (
    <form key={key} action={action} className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        {canDelete && (
          <button
            type="button"
            disabled={deleting || pending}
            className="text-sm text-danger underline disabled:opacity-50"
            onClick={() => {
              if (window.confirm(`Excluir a variante “${label}” da Nuvemshop? Isso não pode ser desfeito.`)) {
                startDelete(async () => setDeleteMessage(await deleteVariantAction(productId, Number(variant.id))));
              }
            }}
          >
            {deleting ? "Excluindo…" : "Excluir variante"}
          </button>
        )}
      </div>
      {attributes.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {attributes.map((name, i) => (
            <label key={i} className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{name}</span>
              <input name={`value_${i}`} defaultValue={values[i] ?? ""} required maxLength={100} className={fieldClass} aria-invalid={!!err(`value_${i}`)} />
              {err(`value_${i}`) && <span className="text-danger">{err(`value_${i}`)}</span>}
            </label>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">SKU</span>
          <input name="sku" defaultValue={variant.sku ?? ""} maxLength={255} className={fieldClass} />
          {err("sku") && <span className="text-danger">{err("sku")}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Preço (R$)</span>
          <input name="price" defaultValue={ptMoney(variant.price)} inputMode="decimal" required className={fieldClass} />
          {err("price") && <span className="text-danger">{err("price")}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Promocional (R$)</span>
          <input name="promotional_price" defaultValue={ptMoney(variant.promotional_price)} inputMode="decimal" className={fieldClass} />
          {err("promotional_price") && <span className="text-danger">{err("promotional_price")}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Estoque</span>
          <input name="stock" defaultValue={variant.stock_management ? String(variant.stock ?? "") : ""} inputMode="numeric" className={fieldClass} />
          {err("stock") && <span className="text-danger">{err("stock")}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Peso (kg)</span>
          <input name="weight" defaultValue={ptWeight(variant.weight)} inputMode="decimal" className={fieldClass} />
          {err("weight") && <span className="text-danger">{err("weight")}</span>}
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" name="stock_management" defaultChecked={variant.stock_management} />
          <span>Controlar estoque</span>
        </label>
      </div>
      {images.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm text-muted">Foto da variação</legend>
          <div className="flex flex-wrap gap-2">
            <label className="cursor-pointer">
              <input type="radio" name="image_id" value="" defaultChecked={variant.image_id === null} className="peer sr-only" />
              <span className="flex size-14 items-center justify-center rounded border border-border text-center text-xs text-muted peer-checked:ring-2 peer-checked:ring-primary peer-focus-visible:ring-2">
                Nenhuma
              </span>
            </label>
            {images.map((img, i) => (
              <label key={img.id} className="cursor-pointer">
                <input type="radio" name="image_id" value={img.id} defaultChecked={variant.image_id === img.id} className="peer sr-only" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.src}
                  alt={img.alt || `Imagem ${i + 1}`}
                  loading="lazy"
                  className="size-14 rounded border border-border object-cover peer-checked:ring-2 peer-checked:ring-primary peer-focus-visible:ring-2"
                />
              </label>
            ))}
          </div>
          {err("image_id") && <span className="text-sm text-danger">{err("image_id")}</span>}
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Salvando…" : "Salvar variante"}
        </Button>
        {(deleteMessage?.message ?? state?.message) && (
          <span role={(deleteMessage ?? state)?.ok ? "status" : "alert"} className={`text-sm ${(deleteMessage ?? state)?.ok ? "text-success" : "text-danger"}`}>
            {deleteMessage?.message ?? state?.message}
          </span>
        )}
      </div>
    </form>
  );
}

/** Nomes das propriedades (ex.: Cor, Tam). Renomear não mexe nos valores das variantes. */
function AttributesForm({ productId, attributes }: { productId: number; attributes: string[] }) {
  const [state, action, pending] = useActionState<ManageState | null, FormData>(saveAttributes.bind(null, productId), null);
  if (attributes.length === 0) return null;
  return (
    <form key={attributes.join("¦")} action={action} className="mt-3 flex flex-col gap-3 rounded-md border border-border p-3">
      <p className="text-sm font-medium">Propriedades</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        {attributes.map((name, i) => (
          <label key={i} className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Propriedade {i + 1}</span>
            <input name={`name_${i}`} defaultValue={name} required maxLength={100} className={fieldClass} />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Salvando…" : "Salvar propriedades"}
        </Button>
        {state?.message && (
          <span role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

/** Formulário para criar uma variante nova: um valor por propriedade, mais preço, estoque, SKU e peso. */
function NewVariantForm({ productId, attributes }: { productId: number; attributes: string[] }) {
  const [state, action, pending] = useActionState<ManageState | null, FormData>(createProductVariant.bind(null, productId), null);
  const err = (name: string) => state?.fieldErrors?.[name];
  if (attributes.length === 0) {
    return (
      <p className="mt-3 text-sm text-muted">
        Este produto não tem propriedades (como Cor ou Tam), então tem uma variante só. Para criar variações, defina as propriedades na Nuvemshop.
      </p>
    );
  }
  return (
    <details className="mt-3 rounded-md border border-border p-3" open={state?.ok === false}>
      <summary className="cursor-pointer text-sm font-medium">Adicionar variante</summary>
      {/* `key` limpa o formulário depois de criar (o espelho muda e a lista é recarregada). */}
      <form key={state?.ok ? "ok" : "novo"} action={action} className="mt-3 flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {attributes.map((name, i) => (
            <label key={i} className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{name}</span>
              <input name={`value_${i}`} required maxLength={100} className={fieldClass} aria-invalid={!!err(`value_${i}`)} />
              {err(`value_${i}`) && <span className="text-danger">{err(`value_${i}`)}</span>}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">SKU</span>
            <input name="sku" maxLength={255} className={fieldClass} />
            {err("sku") && <span className="text-danger">{err("sku")}</span>}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Preço (R$)</span>
            <input name="price" inputMode="decimal" required className={fieldClass} />
            {err("price") && <span className="text-danger">{err("price")}</span>}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Promocional (R$)</span>
            <input name="promotional_price" inputMode="decimal" className={fieldClass} />
            {err("promotional_price") && <span className="text-danger">{err("promotional_price")}</span>}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Estoque</span>
            <input name="stock" inputMode="numeric" className={fieldClass} />
            {err("stock") && <span className="text-danger">{err("stock")}</span>}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Peso (kg)</span>
            <input name="weight" inputMode="decimal" className={fieldClass} />
            {err("weight") && <span className="text-danger">{err("weight")}</span>}
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" name="stock_management" />
            <span>Controlar estoque</span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Criando…" : "Criar variante"}
          </Button>
          {state?.message && (
            <span role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
              {state.message}
            </span>
          )}
        </div>
      </form>
    </details>
  );
}

export function VariantsEditor({ productId, variants, images, attributes }: { productId: number; variants: Variant[]; images: ImageRow[]; attributes: string[] }) {
  return (
    <Card>
      <h2 className="text-base font-semibold">Variantes</h2>
      <p className="mt-1 text-sm text-muted">
        Cada variante é salva separadamente na Nuvemshop. Sem controle de estoque, a quantidade é ilimitada.
      </p>
      <AttributesForm productId={productId} attributes={attributes} />
      <div className="mt-3 flex flex-col gap-3">
        {variants.map((v) => (
          <VariantRow key={v.id} productId={productId} variant={v} images={images} attributes={attributes} canDelete={variants.length > 1} />
        ))}
      </div>
      <NewVariantForm productId={productId} attributes={attributes} />
    </Card>
  );
}
