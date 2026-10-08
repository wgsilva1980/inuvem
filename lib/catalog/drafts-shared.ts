/** Tipos e limites dos rascunhos de produto, sem dependências (usados também pelo navegador). */
import type { Recorte } from "@/lib/images/recorte";

export const MAX_FOTOS_RASCUNHO = 12;

/** Como a foto será enquadrada ao subir para a loja (o mesmo que "Tipo da foto" e "Enquadramento" da tela do produto). */
export interface EnquadramentoFoto {
  tipo: "auto" | "peca" | "modelo";
  enquadramento: "auto" | "ajustar" | "cortar" | "manual";
  /** Só vale com enquadramento "manual". */
  recorte: Recorte | null;
}

export const ENQUADRAMENTO_PADRAO: EnquadramentoFoto = { tipo: "auto", enquadramento: "auto", recorte: null };

export const enquadramentoPadrao = (o: EnquadramentoFoto | null | undefined): boolean => !o || (o.tipo === "auto" && o.enquadramento === "auto");

/** Põe o enquadramento nos campos do formulário de envio de foto (`tipo`, `enquadramento`, `recorte`). */
export function aplicarEnquadramento(body: FormData, o: EnquadramentoFoto | null | undefined): void {
  const e = o ?? ENQUADRAMENTO_PADRAO;
  body.set("tipo", e.tipo);
  body.set("enquadramento", e.enquadramento);
  if (e.enquadramento === "manual" && e.recorte) body.set("recorte", JSON.stringify(e.recorte));
  else body.delete("recorte");
}

/** Foto guardada no Blob de um rascunho. */
export interface FotoSalva {
  pathname: string;
  name: string;
  contentType: string;
  bytes: number;
  /** Enquadramento escolhido para esta foto (ausente = automático). */
  enquadramento?: EnquadramentoFoto;
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
