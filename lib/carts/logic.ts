import type { Checkout } from "@/lib/nuvemshop/checkouts";
import { separarTelefone } from "@/lib/customers/map";

export interface ItemCarrinho {
  nome: string;
  quantidade: number;
  preco: number;
}

export interface Carrinho {
  id: number;
  nome: string | null;
  /** Primeiro nome, com inicial maiúscula. */
  primeiroNome: string | null;
  email: string | null;
  /** Número para o WhatsApp com o DDI (55), só dígitos; null se o telefone não é válido. */
  whatsapp: string | null;
  itens: ItemCarrinho[];
  total: number;
  criadoEm: string;
  /** Link para a cliente voltar ao carrinho. */
  url: string | null;
}

const nomeDe = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim().slice(0, 200) || null;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const t = typeof o.pt === "string" ? o.pt : Object.values(o).find((x): x is string => typeof x === "string");
    return t?.trim().slice(0, 200) || null;
  }
  return null;
};

const dinheiro = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};

const titulo = (s: string) => s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1).toLocaleLowerCase("pt-BR");

/** Carrinho abandonado pronto para mostrar. Devolve null se já foi concluído, está sem data válida ou sem como falar com a cliente. */
export function normalizarCarrinho(c: Checkout): Carrinho | null {
  if (c.completed_at && Number.isFinite(Date.parse(c.completed_at))) return null;
  const criado = c.created_at && Number.isFinite(Date.parse(c.created_at)) ? new Date(c.created_at).toISOString() : null;
  if (!criado) return null;
  const tel = separarTelefone(c.contact_phone);
  const digitos = tel.mobile ?? tel.phone;
  const email = c.contact_email?.trim().toLowerCase() || null;
  const whatsapp = digitos ? `55${digitos}` : null;
  if (!whatsapp && !email) return null;
  const nome = c.contact_name?.trim().replace(/\s+/g, " ").slice(0, 120) || null;
  const itens = (c.products ?? []).map((p): ItemCarrinho => {
    const q = Math.round(Number(p.quantity));
    return { nome: nomeDe(p.name) ?? "Produto", quantidade: Number.isFinite(q) && q > 0 ? q : 1, preco: dinheiro(p.price) };
  });
  const total = dinheiro(c.total) || itens.reduce((s, i) => s + i.preco * i.quantidade, 0);
  return {
    id: c.id,
    nome,
    primeiroNome: nome ? titulo(nome.split(" ")[0]!) : null,
    email,
    whatsapp,
    itens,
    total: Math.round(total * 100) / 100,
    criadoEm: criado,
    url: c.abandoned_checkout_url?.startsWith("https://") ? c.abandoned_checkout_url : null,
  };
}

/** Link que abre o WhatsApp já com a conversa e o texto escritos (a pessoa só aperta enviar). */
export const linkWhatsapp = (numero: string, texto: string): string => `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;

export const linkEmail = (email: string, assunto: string, texto: string): string => `mailto:${email}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(texto)}`;

/** Há quanto tempo, em português: "20 min", "3 h", "2 dias". */
export function idadeTexto(iso: string, agora = Date.now()): string {
  const min = Math.max(0, Math.round((agora - Date.parse(iso)) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} dias`;
}

/**
 * Carrinhos para trabalhar agora: mais de `minMinutos` parados (a cliente pode ainda estar comprando) e de no máximo `maxDias`, do mais
 * valioso para o menos, sem repetir a mesma cliente (mesmo WhatsApp ou e-mail): fica o carrinho mais recente.
 */
export function carrinhosParaTrabalhar(lista: Carrinho[], opts: { minMinutos: number; maxDias: number; agora?: number }): Carrinho[] {
  const agora = opts.agora ?? Date.now();
  const recentes = lista
    .filter((c) => agora - Date.parse(c.criadoEm) >= opts.minMinutos * 60_000 && agora - Date.parse(c.criadoEm) <= opts.maxDias * 86_400_000)
    .sort((a, b) => Date.parse(b.criadoEm) - Date.parse(a.criadoEm));
  const vistos = new Set<string>();
  const out: Carrinho[] = [];
  for (const c of recentes) {
    const chave = c.whatsapp ?? c.email!;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push(c);
  }
  return out.sort((a, b) => b.total - a.total || Date.parse(b.criadoEm) - Date.parse(a.criadoEm));
}
