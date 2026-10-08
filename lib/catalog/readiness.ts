import { textoDaDescricao } from "@/lib/seo/text";
import { PROPRIEDADES_PADRAO } from "@/lib/bulk/operations";
import type { ProdutoAuditado } from "@/lib/images/audit";
import type { ProductDetail } from "./query";

export type StatusItem = "ok" | "falta" | "atencao" | "info";

export interface ItemChecklist {
  chave: string;
  rotulo: string;
  /** Obrigatório: sem ele o produto não deve ir para a vitrine. Os demais são recomendações. */
  obrigatorio: boolean;
  status: StatusItem;
  detalhe: string;
  /** Âncora da seção da página onde se resolve (opcional). */
  ancora?: string;
}

export interface Checklist {
  itens: ItemChecklist[];
  /** Todos os obrigatórios atendidos. */
  pronto: boolean;
  obrigatoriosFaltando: number;
  recomendadosFaltando: number;
  ok: number;
  total: number;
}

/** Descrição curta demais para vender (texto puro, sem HTML). */
export const DESCRICAO_MIN = 80;
export const FOTOS_RECOMENDADAS = 3;

const positivo = (v: string | null | undefined) => v !== null && v !== undefined && v !== "" && Number(v) > 0;
const preenchido = (v: string | null | undefined) => (v ?? "").trim() !== "";

const lista = (nomes: string[], max = 4) => (nomes.length <= max ? nomes.join(", ") : `${nomes.slice(0, max).join(", ")} e mais ${nomes.length - max}`);

/** Nome curto de uma variante (valores das propriedades ou SKU), para apontar qual está incompleta. */
function nomeVariante(v: ProductDetail["variants"][number], i: number): string {
  const valores = v.values.map((x) => (x && typeof x === "object" ? String((x as Record<string, unknown>).pt ?? "") : "")).filter(Boolean);
  return valores.length > 0 ? valores.join(" / ") : v.sku ? `SKU ${v.sku}` : `variante ${i + 1}`;
}

/**
 * Confere se o produto está pronto para ir para a vitrine, só com o que o espelho já tem. Obrigatórios: foto, preço, categoria,
 * descrição e estoque disponível. Recomendados: mais fotos, fotos no padrão, SEO, SKU, COR/TAMANHO, peso e medidas, Google Shopping, tags.
 */
export function avaliarProntidao(produto: ProductDetail, imagens: number, auditoria: ProdutoAuditado | null): Checklist {
  const itens: ItemChecklist[] = [];
  const add = (i: ItemChecklist) => itens.push(i);
  const vs = produto.variants;

  // --- obrigatórios ---
  add(
    imagens > 0
      ? { chave: "foto", rotulo: "Tem foto", obrigatorio: true, status: "ok", detalhe: `${imagens} ${imagens === 1 ? "foto" : "fotos"}.`, ancora: "imagens" }
      : { chave: "foto", rotulo: "Tem foto", obrigatorio: true, status: "falta", detalhe: "Sem fotos, o produto não vende. Adicione na seção Imagens.", ancora: "imagens" },
  );

  const semPreco = vs.map((v, i) => (positivo(v.price) ? null : nomeVariante(v, i))).filter((x): x is string => x !== null);
  add(
    vs.length > 0 && semPreco.length === 0
      ? { chave: "preco", rotulo: "Preço em todas as variações", obrigatorio: true, status: "ok", detalhe: "Todas têm preço." }
      : { chave: "preco", rotulo: "Preço em todas as variações", obrigatorio: true, status: "falta", detalhe: vs.length === 0 ? "O produto não tem variações." : `Sem preço: ${lista(semPreco)}.` },
  );

  add(
    produto.categories.length > 0
      ? { chave: "categoria", rotulo: "Categoria", obrigatorio: true, status: "ok", detalhe: lista(produto.categories.map((c) => c.name)) + "." }
      : { chave: "categoria", rotulo: "Categoria", obrigatorio: true, status: "falta", detalhe: "Escolha ao menos uma categoria (é como a cliente encontra a peça)." },
  );

  const texto = textoDaDescricao(produto.description, 5000);
  add(
    texto.length >= DESCRICAO_MIN
      ? { chave: "descricao", rotulo: "Descrição", obrigatorio: true, status: "ok", detalhe: `${texto.length} caracteres.` }
      : { chave: "descricao", rotulo: "Descrição", obrigatorio: true, status: "falta", detalhe: texto.length === 0 ? "Sem descrição." : `Muito curta (${texto.length} caracteres; o ideal é a partir de ${DESCRICAO_MIN}).` },
  );

  const controladas = vs.filter((v) => v.stock_management);
  const comEstoque = controladas.some((v) => (v.stock ?? 0) > 0);
  if (controladas.length === 0) {
    add({ chave: "estoque", rotulo: "Estoque disponível", obrigatorio: true, status: "ok", detalhe: "Sem controle de estoque (sempre disponível)." });
  } else if (comEstoque) {
    add({ chave: "estoque", rotulo: "Estoque disponível", obrigatorio: true, status: "ok", detalhe: "Há quantidade em estoque." });
  } else {
    add({
      chave: "estoque",
      rotulo: "Estoque disponível",
      obrigatorio: true,
      status: "falta",
      detalhe: "Todas as variações estão com estoque zerado. Se a regra de Automações estiver ligada, o produto sai da loja de novo logo depois de publicado.",
    });
  }

  // --- recomendados ---
  add(
    imagens >= FOTOS_RECOMENDADAS
      ? { chave: "fotos_mais", rotulo: `${FOTOS_RECOMENDADAS} ou mais fotos`, obrigatorio: false, status: "ok", detalhe: `${imagens} fotos.`, ancora: "imagens" }
      : { chave: "fotos_mais", rotulo: `${FOTOS_RECOMENDADAS} ou mais fotos`, obrigatorio: false, status: imagens === 0 ? "falta" : "atencao", detalhe: `Tem ${imagens}; mais ângulos e detalhes ajudam a vender.`, ancora: "imagens" },
  );

  if (imagens > 0) {
    const medidas = auditoria?.imagens.filter((i) => i.medida && !i.medida.error) ?? [];
    const comProblema = (auditoria?.imagens ?? []).filter((i) => i.problemas.length > 0);
    if (!auditoria || medidas.length < imagens) {
      add({ chave: "fotos_padrao", rotulo: "Fotos no padrão da loja", obrigatorio: false, status: "info", detalhe: "Ainda não conferidas. Rode a auditoria em Imagens para medir.", ancora: "imagens" });
    } else if (comProblema.length > 0 || auditoria.proporcoesMisturadas) {
      const partes = [comProblema.length > 0 ? `${comProblema.length} ${comProblema.length === 1 ? "foto fora" : "fotos fora"} do padrão (tamanho, proporção, peso ou formato)` : null, auditoria.proporcoesMisturadas ? "proporções misturadas" : null].filter(Boolean);
      add({ chave: "fotos_padrao", rotulo: "Fotos no padrão da loja", obrigatorio: false, status: "atencao", detalhe: `${partes.join("; ")}. Use Reenquadrar ou padronize em Imagens.`, ancora: "imagens" });
    } else {
      add({ chave: "fotos_padrao", rotulo: "Fotos no padrão da loja", obrigatorio: false, status: "ok", detalhe: "Todas no padrão e na mesma proporção.", ancora: "imagens" });
    }
  }

  const t = produto.seo_title.trim();
  add(
    t.length >= 20 && t.length <= 70
      ? { chave: "seo_titulo", rotulo: "Título de SEO", obrigatorio: false, status: "ok", detalhe: `${t.length} caracteres.` }
      : { chave: "seo_titulo", rotulo: "Título de SEO", obrigatorio: false, status: "atencao", detalhe: t === "" ? "Em branco (a loja usa o nome do produto)." : `${t.length} caracteres; o ideal é de 20 a 70.` },
  );
  const d = produto.seo_description.trim();
  add(
    d.length >= 100 && d.length <= 320
      ? { chave: "seo_descricao", rotulo: "Descrição de SEO", obrigatorio: false, status: "ok", detalhe: `${d.length} caracteres.` }
      : { chave: "seo_descricao", rotulo: "Descrição de SEO", obrigatorio: false, status: "atencao", detalhe: d === "" ? "Em branco (o Google escolhe um trecho qualquer)." : `${d.length} caracteres; o ideal é de 100 a 320.` },
  );

  const semSku = vs.map((v, i) => (preenchido(v.sku) ? null : nomeVariante(v, i))).filter((x): x is string => x !== null);
  add(
    semSku.length === 0 && vs.length > 0
      ? { chave: "sku", rotulo: "SKU em todas as variações", obrigatorio: false, status: "ok", detalhe: "Todas têm SKU." }
      : { chave: "sku", rotulo: "SKU em todas as variações", obrigatorio: false, status: "atencao", detalhe: `Sem SKU: ${lista(semSku)}.` },
  );

  if (vs.length > 1) {
    const nomes = produto.attributes.map((a) => a.trim().toUpperCase());
    const padrao = nomes.length === PROPRIEDADES_PADRAO.length && PROPRIEDADES_PADRAO.every((n, i) => nomes[i] === n);
    const incompletas = vs.map((v, i) => (v.values.length >= PROPRIEDADES_PADRAO.length && v.values.every((x) => x && typeof x === "object" && String((x as Record<string, unknown>).pt ?? "").trim() !== "") ? null : nomeVariante(v, i))).filter((x): x is string => x !== null);
    add(
      padrao && incompletas.length === 0
        ? { chave: "propriedades", rotulo: "Propriedades COR e TAMANHO", obrigatorio: false, status: "ok", detalhe: "Padronizadas em todas as variações." }
        : { chave: "propriedades", rotulo: "Propriedades COR e TAMANHO", obrigatorio: false, status: "atencao", detalhe: !padrao ? `As propriedades são ${nomes.length > 0 ? nomes.join(" e ") : "(nenhuma)"}; o padrão da loja é COR e TAMANHO.` : `Variações sem cor ou tamanho: ${lista(incompletas)}.` },
    );
  }

  const semPeso = vs.filter((v) => !positivo(v.weight)).length;
  const semMedidas = vs.filter((v) => !positivo(v.height) || !positivo(v.width) || !positivo(v.depth)).length;
  add(
    semPeso === 0 && semMedidas === 0 && vs.length > 0
      ? { chave: "frete", rotulo: "Peso e medidas (frete)", obrigatorio: false, status: "ok", detalhe: "Peso, altura, largura e profundidade preenchidos." }
      : { chave: "frete", rotulo: "Peso e medidas (frete)", obrigatorio: false, status: "atencao", detalhe: [semPeso > 0 ? `${semPeso} sem peso` : null, semMedidas > 0 ? `${semMedidas} sem altura, largura ou profundidade` : null].filter(Boolean).join("; ") + ". O cálculo do frete depende disso." },
  );

  const semGoogle = vs.filter((v) => !preenchido(v.gender) || !preenchido(v.age_group)).length;
  add(
    semGoogle === 0 && vs.length > 0
      ? { chave: "google", rotulo: "Sexo e faixa etária (Google Shopping)", obrigatorio: false, status: "ok", detalhe: "Preenchidos." }
      : { chave: "google", rotulo: "Sexo e faixa etária (Google Shopping)", obrigatorio: false, status: "atencao", detalhe: `${semGoogle} ${semGoogle === 1 ? "variação sem" : "variações sem"} sexo ou faixa etária.` },
  );

  add(
    preenchido(produto.tags)
      ? { chave: "tags", rotulo: "Tags", obrigatorio: false, status: "ok", detalhe: `${produto.tags!.split(",").filter((x) => x.trim()).length} tags.` }
      : { chave: "tags", rotulo: "Tags", obrigatorio: false, status: "atencao", detalhe: "Sem tags." },
  );

  const obrigatoriosFaltando = itens.filter((i) => i.obrigatorio && i.status !== "ok").length;
  const recomendadosFaltando = itens.filter((i) => !i.obrigatorio && (i.status === "falta" || i.status === "atencao")).length;
  return { itens, pronto: obrigatoriosFaltando === 0, obrigatoriosFaltando, recomendadosFaltando, ok: itens.filter((i) => i.status === "ok").length, total: itens.length };
}
