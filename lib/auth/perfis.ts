/**
 * Perfis de acesso ao painel. O padrão é NEGAR: só o perfil "admin" entra em tudo. Os demais só entram nas áreas que a página ou a rota
 * pedem explicitamente com `requireAdmin("area")` / `requireAdminApi("area")`. Uma página ou rota nova, sem área, já nasce restrita a administradores.
 */
export const PERFIS = {
  admin: { rotulo: "Administrador", descricao: "Acesso total: catálogo, vendas, custos, clientes, backup e usuários.", inicio: "/" },
  expedicao: { rotulo: "Expedição e estoque", descricao: "Só vê e usa a Expedição (fila de envio e separação) e o Estoque. Sem acesso a custos, vendas, clientes, backup, usuários nem edição de produtos.", inicio: "/expedicao" },
} as const;
export type Perfil = keyof typeof PERFIS;
export const PERFIS_LISTA = Object.keys(PERFIS) as Perfil[];
export const ehPerfil = (x: unknown): x is Perfil => typeof x === "string" && x in PERFIS;

/** Áreas que um perfil restrito pode receber. Cada uma corresponde a páginas e rotas que chamam `requireAdmin(area)`. */
export type Area = "expedicao" | "estoque";

const AREAS: Record<Perfil, readonly Area[] | "todas"> = { admin: "todas", expedicao: ["expedicao", "estoque"] };

export function podeAcessar(perfil: Perfil, area?: Area): boolean {
  const permitidas = AREAS[perfil];
  return permitidas === "todas" || (area !== undefined && permitidas.includes(area));
}

/** Para onde mandar quem tentou entrar onde não pode: o início do perfil (que ele sempre pode abrir). */
export const inicioDoPerfil = (perfil: Perfil): string => PERFIS[perfil].inicio;

/** Links do menu de um perfil restrito (o administrador usa o menu completo). */
export const LINKS_RESTRITOS: Record<Exclude<Perfil, "admin">, Array<{ href: string; label: string }>> = {
  expedicao: [
    { href: "/expedicao", label: "Expedição" },
    { href: "/estoque", label: "Estoque" },
  ],
};
