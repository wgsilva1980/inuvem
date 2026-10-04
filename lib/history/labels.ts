const FIXED: Record<string, string> = {
  "produto.atualizar": "Produto editado",
  "variante.atualizar": "Variante editada",
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
