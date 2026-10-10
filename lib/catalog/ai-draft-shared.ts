/** Tipos e constantes do cadastro assistido por IA, sem dependências (usados também pelo navegador). */
import type { FormSalvo } from "./drafts-shared";
/** Quantas fotos o assistente analisa de uma vez. */
export const MAX_FOTOS_IA = 6;
export const NOME_MAX = 90;
/** Quantas fotos o cadastro em lote aceita de uma vez (várias peças). */
export const MAX_FOTOS_LOTE = 30;

export interface CategoriaOpcao {
  id: number;
  name: string;
}

/** Rascunho atual da tela (editado pela pessoa), para o pedido de ajuste partir dele. */
export interface RascunhoAtual {
  nome?: string;
  descricao?: string;
  tags?: string;
  seoTitulo?: string;
  seoDescricao?: string;
}

export interface FotoAnalisada {
  alt: string;
  /** 1 a 5, como vitrine da peça. */
  qualidade: number;
  observacao: string;
}

export interface RascunhoIA {
  nome: string;
  /** HTML simples já limpo (parágrafos e lista de detalhes). */
  descricaoHtml: string;
  categoriaIds: number[];
  tags: string;
  /** Cores da peça vistas nas fotos (grafia padronizada). */
  cores: string[];
  seoTitulo: string;
  seoDescricao: string;
  /** Uma por foto enviada, na mesma ordem. */
  fotos: FotoAnalisada[];
  /** Índice (0-based) da foto que a IA acha melhor como principal. */
  fotoPrincipal: number;
  /** Só o que está escrito nas anotações da pessoa (a IA não chuta). Vazio = não informado. */
  preco: string;
  promocional: string;
  tamanhos: string[];
  pesoKg: string;
  avisos: string[];
  entrada: number;
  saida: number;
}

/** Campos do formulário de novo produto a partir da análise da IA (o que a pessoa vê ao abrir o rascunho, com as etiquetas "sugerido pela IA"). */
export function rascunhoParaForm(d: RascunhoIA): FormSalvo {
  const marcados = ["name", "description", "seo_title", "seo_description"];
  const add = (cond: boolean, chave: string) => cond && marcados.push(chave);
  add(d.tags !== "", "tags");
  add(d.categoriaIds.length > 0, "categories");
  add(d.cores.length > 0, "cores");
  add(d.tamanhos.length > 0, "tamanhos");
  add(d.preco !== "", "preco");
  add(d.promocional !== "", "promocional");
  add(d.pesoKg !== "", "peso");
  return {
    name: d.nome,
    description: d.descricaoHtml,
    tags: d.tags,
    categorias: d.categoriaIds,
    modo: d.cores.length > 0 || d.tamanhos.length > 0 ? "variacoes" : "simples",
    cores: d.cores.join(", "),
    tamanhos: d.tamanhos.join(", "),
    preco: d.preco,
    promocional: d.promocional,
    peso: d.pesoKg,
    controlar: true,
    estoque: "",
    seoTitulo: d.seoTitulo,
    seoDescricao: d.seoDescricao,
    iaMarcados: marcados,
  };
}
