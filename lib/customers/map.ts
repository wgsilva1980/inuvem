import type { Customer } from "@/lib/nuvemshop/customers";

/** Cliente da loja já no formato das nossas tabelas (customers e contacts). */
export interface ClienteMapeado {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  document: string | null;
  person_type: "fisica" | "juridica";
  zip: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  total_spent: number;
  last_order_id: number | null;
  accepts_marketing: boolean | null;
  created_at_remote: string | null;
  updated_at_remote: string | null;
}

const UF_POR_NOME: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE", "distrito federal": "DF", "espirito santo": "ES", goias: "GO",
  maranhao: "MA", "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG", para: "PA", paraiba: "PB", parana: "PR", pernambuco: "PE",
  piaui: "PI", "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR", "santa catarina": "SC",
  "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};
const UFS = new Set(Object.values(UF_POR_NOME));

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const limpo = (s: string | null | undefined, max = 255): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return t === "" ? null : t;
};
const digitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** "São Paulo", "sp", "SP" -> "SP"; o que não for reconhecido vira nulo. */
export function ufDe(provincia: string | null | undefined): string | null {
  const t = (provincia ?? "").trim();
  if (t === "") return null;
  if (t.length === 2) return UFS.has(t.toUpperCase()) ? t.toUpperCase() : null;
  return UF_POR_NOME[semAcento(t).toLowerCase().replace(/\s+/g, " ")] ?? null;
}

/** Telefone brasileiro: tira o +55; 11 dígitos com 9 depois do DDD é celular; o resto (10 dígitos…) é fixo. */
export function separarTelefone(raw: string | null | undefined): { phone: string | null; mobile: string | null } {
  let d = digitos(raw);
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length < 8 || d.length > 11) return { phone: null, mobile: null };
  if (d.length === 11 && d[2] === "9") return { phone: null, mobile: d };
  return { phone: d, mobile: null };
}

const dataValida = (s: string | null | undefined): string | null => (s && Number.isFinite(Date.parse(s)) ? s : null);

export function mapearCliente(c: Customer): ClienteMapeado {
  const doc = digitos(c.identification);
  const document = doc.length === 11 || doc.length === 14 ? doc : null;
  const email = limpo(c.email, 254)?.toLowerCase() ?? null;
  const a = c.default_address;
  const zip = digitos(a?.zipcode);
  const gasto = Number(c.total_spent);
  return {
    id: c.id,
    name: limpo(c.name) ?? (email ? email.split("@")[0]! : `Cliente ${c.id}`),
    email: email && email.includes("@") ? email : null,
    ...separarTelefone(c.phone),
    document,
    person_type: document?.length === 14 ? "juridica" : "fisica",
    zip: zip.length === 8 ? zip : null,
    street: limpo(a?.address),
    number: limpo(a?.number, 20),
    complement: limpo(a?.floor, 100),
    district: limpo(a?.locality, 100),
    city: limpo(a?.city, 100),
    state: ufDe(a?.province),
    total_spent: Number.isFinite(gasto) && gasto > 0 ? Math.round(gasto * 100) / 100 : 0,
    last_order_id: c.last_order_id ?? null,
    accepts_marketing: c.accepts_marketing ?? null,
    created_at_remote: dataValida(c.created_at),
    updated_at_remote: dataValida(c.updated_at),
  };
}
