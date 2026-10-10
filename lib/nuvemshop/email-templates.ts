import type { NuvemshopClient } from "./client";

/** Modelo de e-mail da loja, como o painel o enxerga. A API só permite LER (a gravação não está documentada). */
export interface ModeloEmail {
  id: string;
  nome: string;
  assunto: string;
  corpo: string;
}

const NOME = ["name", "title", "type", "event", "key", "slug", "template"];
const ASSUNTO = ["subject", "asunto", "email_subject"];
const CORPO = ["body", "content", "html", "html_content", "message", "text", "template_html"];

/** Texto de um campo que pode vir como string ou como objeto multi-idioma ({ pt: "…" }). */
function texto(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o.pt === "string") return o.pt;
    const primeiro = Object.values(o).find((x): x is string => typeof x === "string" && x !== "");
    return primeiro ?? "";
  }
  return "";
}

const primeiro = (o: Record<string, unknown>, chaves: string[]) => {
  for (const k of chaves) {
    const t = texto(o[k]).trim();
    if (t) return t;
  }
  return "";
};

export function modeloDe(raw: unknown): ModeloEmail | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = o.id ?? o.type ?? o.key ?? o.slug;
  if (id === undefined || id === null || String(id) === "") return null;
  const corpo = primeiro(o, CORPO);
  const assunto = primeiro(o, ASSUNTO);
  if (!corpo && !assunto) return null;
  return { id: String(id), nome: primeiro(o, NOME) || `Modelo ${String(id)}`, assunto, corpo };
}

export interface ListaModelos {
  items: ModeloEmail[];
  /** Nomes dos campos que a loja devolveu (para diagnosticar quando nada é reconhecido). */
  campos: string[];
  /** Quantos itens vieram sem assunto nem corpo reconhecíveis. */
  semTexto: number;
}

export async function listEmailTemplates(c: NuvemshopClient): Promise<ListaModelos> {
  const items: ModeloEmail[] = [];
  const campos = new Set<string>();
  let semTexto = 0;
  for await (const page of c.paginate<unknown>("/email_templates")) {
    for (const raw of page.items) {
      if (raw && typeof raw === "object") for (const k of Object.keys(raw)) campos.add(k);
      const m = modeloDe(raw);
      if (m) items.push(m);
      else semTexto++;
    }
  }
  return { items, campos: [...campos].sort(), semTexto };
}
