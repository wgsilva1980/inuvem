/**
 * Os e-mails da loja têm variáveis (ex.: {{ customer.name }}, {% if … %}) que a loja preenche na hora de enviar.
 * Antes de mandar o texto ao Claude, cada variável vira um marcador ⟦n⟧; depois da resposta os marcadores voltam a ser as
 * variáveis originais. Assim a IA não consegue apagar, trocar nem inventar uma variável: o painel confere os marcadores.
 */
const VARIAVEL = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g;
const MARCADOR = /⟦(\d+)⟧/g;

export interface Mascarado {
  texto: string;
  /** Variável original de cada marcador (índice = número do marcador). */
  variaveis: string[];
}

/** Troca cada variável por ⟦n⟧ (variáveis iguais usam o mesmo número). `variaveis` pode vir de outro campo, para a numeração ser única entre assunto e corpo. */
export function mascarar(texto: string, variaveis: string[] = []): Mascarado {
  const lista = [...variaveis];
  const out = texto.replace(VARIAVEL, (v) => {
    let i = lista.indexOf(v);
    if (i < 0) {
      lista.push(v);
      i = lista.length - 1;
    }
    return `⟦${i}⟧`;
  });
  return { texto: out, variaveis: lista };
}

export const marcadoresDe = (texto: string): Set<number> => new Set(Array.from(texto.matchAll(MARCADOR), (m) => Number(m[1])));

/** Volta os marcadores para as variáveis originais. Marcador desconhecido fica como está (e a conferência reclama). */
export function restaurar(texto: string, variaveis: string[]): string {
  return texto.replace(MARCADOR, (m, n: string) => variaveis[Number(n)] ?? m);
}

/** Sequência de tags HTML (só os nomes, na ordem): se mudou, a IA mexeu na estrutura do e-mail. */
export function estrutura(html: string): string {
  return Array.from(html.matchAll(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)/g), (m) => `${m[1]}${(m[2] ?? "").toLowerCase()}`).join(",");
}

/**
 * Confere um campo reescrito (ainda com marcadores) contra o original: mesmas variáveis (nenhuma a menos, nenhuma nova)
 * e mesma estrutura de tags. Devolve os problemas, em português; lista vazia = ok.
 */
export function conferirCampo(rotulo: string, original: Mascarado, reescrito: string): string[] {
  const problemas: string[] = [];
  const antes = marcadoresDe(original.texto);
  const depois = marcadoresDe(reescrito);
  const faltam = [...antes].filter((n) => !depois.has(n));
  const novas = [...depois].filter((n) => !antes.has(n));
  if (faltam.length > 0) problemas.push(`${rotulo}: faltam as variáveis ${faltam.map((n) => original.variaveis[n]).join(", ")}`);
  if (novas.length > 0) problemas.push(`${rotulo}: apareceram variáveis que não existiam`);
  if (estrutura(original.texto) !== estrutura(reescrito)) problemas.push(`${rotulo}: a estrutura HTML (tags) mudou`);
  return problemas;
}

/** O mesmo, para um texto já restaurado (o que o usuário edita): confere as variáveis do original dentro do texto final. */
export function variaveisFaltando(original: string, final: string): string[] {
  const antes = new Set(original.match(VARIAVEL) ?? []);
  const depois = new Set(final.match(VARIAVEL) ?? []);
  return [...antes].filter((v) => !depois.has(v));
}
