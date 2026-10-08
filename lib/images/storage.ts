import { del, get, put } from "@vercel/blob";

/** Onde ficam as cópias das fotos (injetável para testar sem rede). */
export interface BackupStorage {
  put(pathname: string, bytes: Buffer, contentType: string): Promise<void>;
  get(pathname: string): Promise<Buffer>;
  /** Apaga as cópias (pode ser omitido em armazenamentos de teste). */
  del?(pathnames: string[]): Promise<void>;
}

/** Vercel Blob, sempre privado: as cópias só são lidas pelo servidor. */
export const blobStorage: BackupStorage = {
  async put(pathname, bytes, contentType) {
    await put(pathname, bytes, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType });
  },
  async get(pathname) {
    const r = await get(pathname, { access: "private" });
    if (!r || r.statusCode !== 200) throw new Error("cópia não encontrada no armazenamento");
    return Buffer.from(await new Response(r.stream).arrayBuffer());
  },
  async del(pathnames) {
    if (pathnames.length > 0) await del(pathnames);
  },
};
