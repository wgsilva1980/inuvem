import { z } from "zod";
import type { NuvemshopClient } from "./client";
import { locationSchema } from "./types";

/** Somente leitura (multi-estoque). A loja INuvem não usa múltiplos CDs. */
export const listLocations = async (c: NuvemshopClient) => z.array(locationSchema).parse(await c.get("/locations"));
