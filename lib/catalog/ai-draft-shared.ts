/** Tipos e constantes do cadastro assistido por IA, sem dependências (usados também pelo navegador). */
/** Quantas fotos o assistente analisa de uma vez. */
export const MAX_FOTOS_IA = 6;
export const NOME_MAX = 90;

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
