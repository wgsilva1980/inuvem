import { Client } from "pg";
import { loadLocalEnv, scriptConnectionString } from "./_env";

loadLocalEnv();

const url = scriptConnectionString();
const emails = (process.argv.slice(2).length ? process.argv.slice(2) : (process.env.ADMIN_EMAILS ?? "").split(","))
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

if (!url || emails.length === 0) {
  console.error("Uso: npm run db:seed-admin -- email@dominio.com  (ou defina ADMIN_EMAILS em .env.local)");
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();
try {
  for (const email of emails) {
    await client.query("INSERT INTO admins (email) VALUES ($1) ON CONFLICT DO NOTHING", [email]);
    console.log(`Admin liberado: ${email}`);
  }
} finally {
  await client.end();
}
