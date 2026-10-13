/** Chamada da tela de edição ao gerador de textos da IA (o mesmo da tela Qualidade). Nada é gravado na loja: o resultado volta para o formulário. */
export interface SugestaoIa {
  descricao?: string;
  tags?: string;
  seoTitulo?: string;
  seoDescricao?: string;
  avisos: string[];
}

export async function sugerirIa(produtoId: string, campos: Array<"descricao" | "tags" | "seo">): Promise<SugestaoIa> {
  const res = await fetch("/api/qualidade/sugerir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ produtoId, campos }) });
  const d = (await res.json().catch(() => ({}))) as Partial<SugestaoIa> & { error?: string };
  if (!res.ok || d.error) throw new Error(d.error ?? "A IA não respondeu agora. Tente de novo.");
  return { descricao: d.descricao, tags: d.tags, seoTitulo: d.seoTitulo, seoDescricao: d.seoDescricao, avisos: d.avisos ?? [] };
}

/** Junta as tags que já estão no campo com as novas, sem repetir (ignora maiúsculas) e sem perder nenhuma das que a pessoa já tinha. */
export function juntarTags(atuais: string, novas: string): string {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const t of `${atuais},${novas}`.split(",").map((x) => x.trim()).filter(Boolean)) {
    const k = t.toLocaleLowerCase("pt-BR");
    if (!vistos.has(k)) {
      vistos.add(k);
      out.push(t);
    }
  }
  return out.join(", ");
}
