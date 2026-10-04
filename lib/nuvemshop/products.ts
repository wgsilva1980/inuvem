import { z } from "zod";
import type { NuvemshopClient, Page } from "./client";
import { productSchema, type Product, type ProductInput } from "./types";

export interface ListProductsParams {
  page?: number;
  per_page?: number;
  q?: string;
  published?: boolean;
  category_id?: number;
  sku?: string;
  updated_at_min?: string;
  fields?: string;
}

const parse = (raw: unknown): Product => productSchema.parse(raw);
const parseList = (items: unknown[]): Product[] => z.array(productSchema).parse(items);

export async function listProducts(c: NuvemshopClient, params: ListProductsParams = {}): Promise<Page<Product>> {
  const { page = 1, per_page = 200, ...query } = params;
  const result = await c.getPage<unknown>("/products", query, page, per_page);
  return { ...result, items: parseList(result.items) };
}

/** Itera todas as páginas (para sync). */
export async function* paginateProducts(
  c: NuvemshopClient,
  params: Omit<ListProductsParams, "page"> = {},
): AsyncGenerator<Page<Product>> {
  const { per_page = 200, ...query } = params;
  for await (const page of c.paginate<unknown>("/products", query, per_page)) {
    yield { ...page, items: parseList(page.items) };
  }
}

export const getProduct = async (c: NuvemshopClient, id: number) => parse(await c.get(`/products/${id}`));
export const getProductBySku = async (c: NuvemshopClient, sku: string) =>
  parse(await c.get(`/products/sku/${encodeURIComponent(sku)}`));
export const createProduct = async (c: NuvemshopClient, input: ProductInput) => parse(await c.post("/products", input));
export const updateProduct = async (c: NuvemshopClient, id: number, input: ProductInput) =>
  parse(await c.put(`/products/${id}`, input));
export const deleteProduct = (c: NuvemshopClient, id: number) => c.delete(`/products/${id}`);
