/** Tipos e limites dos rascunhos de produto, sem dependências (usados também pelo navegador). */
export const MAX_FOTOS_RASCUNHO = 12;

/** Foto guardada no Blob de um rascunho. */
export interface FotoSalva {
  pathname: string;
  name: string;
  contentType: string;
  bytes: number;
}

/** Campos do formulário de novo produto, como a pessoa os deixou. */
export interface FormSalvo {
  name: string;
  /** HTML da descrição. */
  description: string;
  tags: string;
  categorias: number[];
  modo: "simples" | "variacoes";
  cores: string;
  tamanhos: string;
  preco: string;
  promocional: string;
  peso: string;
  controlar: boolean;
  estoque: string;
  seoTitulo: string;
  seoDescricao: string;
  /** Campos que ainda são sugestão da IA (mantém a etiqueta "✨ Sugerido pela IA"). */
  iaMarcados: string[];
}

/** O que a IA disse de cada foto na última análise (alt e nota), na mesma ordem das fotos do rascunho. */
export interface IaSalva {
  avisos: string[];
  fotos: Array<{ alt: string; qualidade: number; observacao: string }>;
}

export interface RascunhoSalvo {
  id: number;
  titulo: string;
  notas: string;
  form: FormSalvo | null;
  ia: IaSalva | null;
  fotos: FotoSalva[];
  status: "rascunho" | "criado";
  productId: number | null;
  atualizadoEm: string;
}

export interface RascunhoResumo {
  id: number;
  titulo: string;
  fotos: number;
  status: "rascunho" | "criado";
  productId: number | null;
  atualizadoEm: string;
}
