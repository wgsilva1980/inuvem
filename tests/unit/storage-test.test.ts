import { describe, expect, it } from "vitest";
import { testarArmazenamento } from "@/lib/images/storage-test";

describe("teste do armazenamento (Blob)", () => {
  it("sem BLOB_READ_WRITE_TOKEN avisa em vez de falhar", async () => {
    const r = await testarArmazenamento({});
    expect(r).toMatchObject({ configurado: false, gravou: false, acesso: null });
    expect(r.erro).toContain("BLOB_READ_WRITE_TOKEN");
  });
});
