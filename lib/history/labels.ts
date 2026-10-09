const FIXED: Record<string, string> = {
  "produto.atualizar": "Produto editado",
  "produto.criar": "Produto criado",
  "variante.atualizar": "Variante editada",
  "variante.criar": "Variante criada",
  "variante.apagar": "Variante excluída",
  "produto.propriedades": "Propriedades do produto editadas",
  "produto.apagar": "Produto excluído",
  "categoria.seo": "SEO da categoria gravado",
  "pagina.seo": "SEO da página gravado",
  "cupom.criar": "Cupons criados em lote",
  "cupom.desativar": "Cupons desativados",
  "cupom.exportar": "Cupons exportados para Excel",
  "venda.sincronizar": "Vendas da loja lidas",
  "promocao.criar": "Promoção agendada",
  "promocao.cancelar": "Promoção cancelada",
  "promocao.iniciar": "Promoção iniciada (descontos aplicados)",
  "promocao.no_ar": "Promoção no ar",
  "promocao.encerrar": "Promoção encerrada (preços sendo restaurados)",
  "promocao.encerrada": "Promoção encerrada (preços restaurados)",
  "produto.despublicar_sem_estoque": "Produto despublicado automaticamente (sem estoque)",
  "lote.excluir": "Lote: produto excluído",
  "contato.criar": "Contato cadastrado",
  "contato.atualizar": "Contato editado",
  "contato.apagar": "Contato excluído",
  "contato.exportar": "Contatos exportados para Excel",
  "cliente.sincronizar": "Clientes da loja sincronizados",
  "usuario.adicionar": "Usuário adicionado",
  "usuario.remover": "Usuário removido",
  "imagem.adicionar": "Imagem adicionada (por endereço)",
  "imagem.enviar": "Imagem enviada (arquivo)",
  "imagem.remover": "Imagem removida",
  "imagem.reordenar": "Imagens reordenadas",
  "imagem.reenquadrar": "Foto reenquadrada manualmente",
  "categoria.criar": "Categoria criada",
  "categoria.atualizar": "Categoria editada",
  "categoria.apagar": "Categoria apagada",
  "lote.criar": "Lote criado (pré-visualização)",
  "lote.iniciar": "Lote iniciado",
  "lote.cancelar": "Lote cancelado",
  "lote.reverter": "Lote de reversão criado",
  "lote.propriedades": "Lote: propriedades padronizadas no produto",
  "lote.valores": "Lote: grafia dos valores padronizada no produto",
  "lote.ordem": "Lote: ordem das propriedades corrigida no produto",
  "lote.completar": "Lote: COR e TAMANHO completados no produto",
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
