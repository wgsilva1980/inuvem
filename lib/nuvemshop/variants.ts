import { z } from "zod";
import type { NuvemshopClient } from "./client";
import { variantSchema, type Variant, type VariantInput } from "./types";

export const listVariants = async (c: NuvemshopClient, productId: number) =>
  z.array(variantSchema).parse(await c.get(`/products/${productId}/variants`));
export const getVariant = async (c: NuvemshopClient, productId: number, variantId: number): Promise<Variant> =>
  variantSchema.parse(await c.get(`/products/${productId}/variants/${variantId}`));
export const createVariant = async (c: NuvemshopClient, productId: number, input: VariantInput): Promise<Variant> =>
  variantSchema.parse(await c.post(`/products/${productId}/variants`, input));
export const updateVariant = async (
  c: NuvemshopClient,
  productId: number,
  variantId: number,
  input: VariantInput,
): Promise<Variant> => variantSchema.parse(await c.put(`/products/${productId}/variants/${variantId}`, input));
export const deleteVariant = (c: NuvemshopClient, productId: number, variantId: number) =>
  c.delete(`/products/${productId}/variants/${variantId}`);
