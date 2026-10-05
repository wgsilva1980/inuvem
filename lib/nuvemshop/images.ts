import { z } from "zod";
import type { NuvemshopClient } from "./client";
import { imageSchema, type ProductImage } from "./types";

export const listImages = async (c: NuvemshopClient, productId: number) =>
  z.array(imageSchema).parse(await c.get(`/products/${productId}/images`));
export const getImage = async (c: NuvemshopClient, productId: number, imageId: number): Promise<ProductImage> =>
  imageSchema.parse(await c.get(`/products/${productId}/images/${imageId}`));
/** Envia uma imagem como arquivo em base64 (`attachment` + `filename`). O formato exato é a confirmar na documentação. */
export type ImageUpload = { attachment: string; filename: string; position?: number };
export const createImage = async (
  c: NuvemshopClient,
  productId: number,
  input: ImageUpload,
): Promise<ProductImage> => imageSchema.parse(await c.post(`/products/${productId}/images`, input));
export const deleteImage = (c: NuvemshopClient, productId: number, imageId: number) =>
  c.delete(`/products/${productId}/images/${imageId}`);
/** Reordena (e/ou troca a origem de) uma imagem. A semântica de `position` ao reordenar é a confirmar na documentação. */
export const updateImage = async (
  c: NuvemshopClient,
  productId: number,
  imageId: number,
  input: { position?: number; src?: string; alt?: Record<string, string> | string[] },
): Promise<ProductImage> => imageSchema.parse(await c.put(`/products/${productId}/images/${imageId}`, input));
