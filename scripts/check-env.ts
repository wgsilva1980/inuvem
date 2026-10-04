import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { checkEnv } from "../lib/health";

const file = process.argv[2] ?? ".env.local";
if (!existsSync(file)) {
  console.error(`Arquivo não encontrado: ${file}`);
  console.error("Dica: `vercel env pull .env.vercel` baixa as variáveis da Vercel; depois rode `npm run check:env -- .env.vercel`.");
  process.exit(1);
}

const report = checkEnv(parseEnv(readFileSync(file, "utf8")));
console.log(`Verificando ${file} (valores nunca são exibidos)\n`);
for (const name of report.missing) console.log(`  FALTA     ${name}`);
for (const i of report.invalid) console.log(`  INVÁLIDA  ${i.name}: ${i.problem}`);
for (const name of report.unverifiable) console.log(`  NÃO VERIFICÁVEL  ${name} (variável Sensitive: a CLI da Vercel não baixa o valor)`);
if (report.unverifiable.length) {
  console.log("\n  Para validar as variáveis Sensitive use o deploy no ar:");
  console.log("  curl -H \"Authorization: Bearer $CRON_SECRET\" https://SEU-APP.vercel.app/api/health");
}
for (const w of report.warnings) console.log(`  AVISO     ${w}`);
console.log(
  report.ok
    ? "\nOK: todas as variáveis obrigatórias estão presentes e válidas."
    : report.missing.length || report.invalid.length
      ? "\nHá problemas a corrigir antes do deploy."
      : "\nNenhum erro encontrado, mas há variáveis que este arquivo não consegue comprovar (veja acima).",
);
process.exit(report.ok ? 0 : 1);
