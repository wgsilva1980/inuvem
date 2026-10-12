import { LINKS_RESTRITOS, type Perfil } from "@/lib/auth/perfis";
import { ADMIN_LINKS, NAV_LINKS } from "@/lib/nav";

export interface PaginaBuscavel {
  href: string;
  label: string;
  /** Outras palavras com que a pessoa pode procurar a página. */
  palavras: string;
}

/** Palavras extras por página (o que a pessoa lembra, não o nome do menu). */
const SINONIMOS: Record<string, string> = {
  "/produtos": "catálogo roupas peças cadastro novo produto foto",
  "/categorias": "coleções departamentos",
  "/contatos": "clientes contatos carrinhos whatsapp",
  "/cashback": "cupom volta crédito fidelidade",
  "/promocoes": "desconto liquidação agendar preço promoção",
  "/cupons": "código desconto lote",
  "/vendas": "faturamento pedidos relatório mais vendidos",
  "/custos": "margem lucro custo planilha",
  "/simulador": "preço margem lucro desconto calcular",
  "/estoque": "reposição acabando esgotado",
  "/compras": "fornecedor reposição pedido de compra comprar",
  "/campanhas": "datas black friday natal dia das mães calendário",
  "/qualidade": "nota checklist descrição seo corrigir",
  "/carrinhos": "abandonados recuperar",
  "/expedicao": "envio enviar separação rastreio embalar conferir conferência código de barras celular",
  "/reativacao": "clientes sumidas voltar inativas",
  "/posvenda": "avaliação entrega depois da compra",
  "/segmentos": "clientes grupos exportar campanhas lista",
  "/imagens": "fotos auditoria",
  "/seo": "google título descrição",
  "/conteudo": "blocos páginas guia de medidas",
  "/emails": "modelos e-mails",
  "/selos": "badges",
  "/lote": "lotes edição em massa",
  "/historico": "log mudanças auditoria quem fez",
  "/desfazer": "reverter voltar",
  "/backup": "cópia segurança baixar",
  "/automacoes": "regras sem estoque despublicar",
  "/resumo": "e-mail diário relatório mensal",
  "/alertas": "avisos e-mail webhook pedido pago",
  "/diagnostico": "vigia integrações api webhooks teste",
  "/usuarios": "acesso perfil administrador permissões",
};

const todas = (): PaginaBuscavel[] => [...NAV_LINKS, ...ADMIN_LINKS].map((l) => ({ href: l.href, label: l.label, palavras: SINONIMOS[l.href] ?? "" }));

/** As páginas que o perfil pode abrir (o restrito só as suas). */
export function paginasDoPerfil(perfil: Perfil): PaginaBuscavel[] {
  if (perfil === "admin") return todas();
  return LINKS_RESTRITOS[perfil].map((l) => ({ href: l.href, label: l.label, palavras: SINONIMOS[l.href] ?? "" }));
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Páginas que combinam com o texto: o nome do menu primeiro, depois as palavras extras. Todas as palavras digitadas precisam aparecer. */
export function buscarPaginas(paginas: PaginaBuscavel[], texto: string, max = 6): PaginaBuscavel[] {
  const termos = norm(texto).split(/\s+/).filter(Boolean);
  if (termos.length === 0) return paginas.slice(0, max);
  const pontuadas = paginas
    .map((p) => {
      const nome = norm(p.label);
      const resto = norm(p.palavras);
      if (!termos.every((t) => nome.includes(t) || resto.includes(t))) return null;
      const noNome = termos.every((t) => nome.includes(t));
      return { p, nota: (nome.startsWith(termos[0]!) ? 0 : noNome ? 1 : 2) };
    })
    .filter((x): x is { p: PaginaBuscavel; nota: number } => x !== null)
    .sort((a, b) => a.nota - b.nota);
  return pontuadas.slice(0, max).map((x) => x.p);
}
