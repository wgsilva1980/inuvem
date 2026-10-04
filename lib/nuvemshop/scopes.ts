/** Permissões (scopes) da autorização, como vêm da Nuvemshop: separadas por vírgula (e, por segurança, também por espaço). */
export function parseScopes(scope: string | null | undefined): string[] {
  if (!scope) return [];
  return [...new Set(scope.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}
