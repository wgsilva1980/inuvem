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
for (const w of report.warnings) console.log(`  AVISO     ${w}`);
console.log(report.ok ? "\nOK: todas as variáveis obrigatórias estão presentes e válidas." : "\nHá problemas a corrigir antes do deploy.");
process.exit(report.ok ? 0 : 1);
