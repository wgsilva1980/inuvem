const FIXED: Record<string, string> = {
  "produto.atualizar": "Produto editado",
  "variante.atualizar": "Variante editada",
  "variante.criar": "Variante criada",
  "variante.apagar": "Variante excluída",
  "produto.propriedades": "Propriedades do produto editadas",
  "imagem.adicionar": "Imagem adicionada (por endereço)",
  "imagem.enviar": "Imagem enviada (arquivo)",
  "imagem.remover": "Imagem removida",
  "imagem.reordenar": "Imagens reordenadas",
  "categoria.criar": "Categoria criada",
  "categoria.atualizar": "Categoria editada",
  "categoria.apagar": "Categoria apagada",
  "lote.criar": "Lote criado (pré-visualização)",
  "lote.iniciar": "Lote iniciado",
  "lote.cancelar": "Lote cancelado",
  "lote.reverter": "Lote de reversão criado",
  "lote.propriedades": "Lote: propriedades padronizadas no produto",
};

const LOTE_OP: Record<string, string> = {
  preco: "preço",
  promocao: "promoção",
  estoque: "estoque",
  publicar: "publicação",
  categoria: "categoria",
};

/** Texto em português para o código da ação gravado no `audit_log`. */
export function acaoLabel(acao: string, entidade?: string): string {
  // "lote.reverter" aparece em dois momentos: ao criar o lote de reversão (entidade "lote") e ao aplicá-lo a cada produto.
  if (acao === "lote.reverter" && entidade === "produto") return "Lote: reversão aplicada ao produto";
  if (FIXED[acao]) return FIXED[acao];
  const [grupo, resto] = acao.split(".");
  if (grupo === "lote" && resto && LOTE_OP[resto]) return `Lote: ${LOTE_OP[resto]} aplicado ao produto`;
  return acao;
}

export const TIPO_LABEL: Record<string, string> = {
  produto: "Produtos",
  variante: "Variantes",
  imagem: "Imagens",
  categoria: "Categorias",
  lote: "Operações em massa",
};

export type AcaoGrupo = "produto" | "variante" | "imagem" | "categoria" | "lote" | "outro";

/** Grupo da ação (para o ícone na lista): o prefixo do código gravado no `audit_log`. */
export function acaoGrupo(acao: string): AcaoGrupo {
  const grupo = acao.split(".")[0];
  return grupo === "produto" || grupo === "variante" || grupo === "imagem" || grupo === "categoria" || grupo === "lote" ? grupo : "outro";
}
