import { z } from "zod";
import type { NuvemshopClient } from "./client";
import { imageSchema, type ProductImage } from "./types";

export const listImages = async (c: NuvemshopClient, productId: number) =>
  z.array(imageSchema).parse(await c.get(`/products/${productId}/images`));
export const getImage = async (c: NuvemshopClient, productId: number, imageId: number): Promise<ProductImage> =>
  imageSchema.parse(await c.get(`/products/${productId}/images/${imageId}`));
/** `src` deve ser uma URL pública acessível pela Nuvemshop (a confirmar: suporte a base64 via `attachment`). */
export const createImage = async (
  c: NuvemshopClient,
  productId: number,
  input: { src: string; position?: number },
): Promise<ProductImage> => imageSchema.parse(await c.post(`/products/${productId}/images`, input));
export const deleteImage = (c: NuvemshopClient, productId: number, imageId: number) =>
  c.delete(`/products/${productId}/images/${imageId}`);
/** Reordena (e/ou troca a origem de) uma imagem. A semântica de `position` ao reordenar é a confirmar na documentação. */
export const updateImage = async (
  c: NuvemshopClient,
  productId: number,
  imageId: number,
  input: { position?: number; src?: string },
): Promise<ProductImage> => imageSchema.parse(await c.put(`/products/${productId}/images/${imageId}`, input));
