# INuvem — painel privado da loja Nuvemshop

Painel web (Next.js + Neon + Vercel) para administrar os produtos da loja na Nuvemshop.
A Nuvemshop é a fonte da verdade; o Postgres (Neon) é um espelho para busca rápida e histórico.

**Status:** Fase 1 (base) concluída — login, conexão OAuth, cliente HTTP com rate limit, migrations e sync completo/incremental.
Próximas: catálogo (2), variantes e imagens (3), operações em massa (4), categorias/dashboard/histórico (5) e webhooks.

## Arquitetura (resumo)

- `app/` — páginas (App Router), rotas `/api/*` e Server Actions.
- `lib/nuvemshop/` — SDK tipado (uma função por endpoint) + `client.ts` (único ponto de saída HTTP: fila/rate limit por loja,
  retry com backoff em 429/5xx, timeout, logs estruturados, token nunca logado).
- `lib/sync/` — motor de sincronização retomável (cursor em `sync_runs`, lotes curtos por causa do timeout da Vercel).
- `lib/auth/` — Neon Auth (magic link) + allowlist de admins (`admins`). Exige e-mail verificado.
- `lib/crypto.ts` — AES-256-GCM para o token da loja (`ENCRYPTION_KEY`).
- `db/migrations/` — SQL puro, aplicado por `npm run db:migrate`.

Segurança: o token da Nuvemshop fica só no servidor, criptografado. O browser nunca fala com a Nuvemshop nem com o banco.
A autorização é feita no servidor (sessão + allowlist) em toda página e rota de API. RLS está ligado em todas as tabelas, sem
políticas (nega qualquer acesso por roles que não sejam a dona, como a Data API).

## Setup local

```bash
npm install            # usa .npmrc (legacy-peer-deps)
cp .env.example .env.local
```

1. **Neon:** `neon deploy` já grava `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_AUTH_BASE_URL` em `.env.local`.
   Para a Vercel use a connection string **pooled** (`DATABASE_URL`).
2. Gere os segredos que faltam:
   ```bash
   openssl rand -base64 32   # NEON_AUTH_COOKIE_SECRET
   openssl rand -base64 32   # ENCRYPTION_KEY (precisa ter exatamente 32 bytes)
   openssl rand -hex 32      # CRON_SECRET
   ```
3. Preencha `NUVEMSHOP_*` (próxima seção) e `ADMIN_EMAILS` (seu e-mail).
4. Banco: `npm run db:migrate` e `npm run db:seed-admin` (libera os e-mails de `ADMIN_EMAILS`).
5. **Neon Auth — magic link:** Console do Neon → projeto → branch `production` → **Auth → Plugins → Magic Link → ligar**
   (expiração sugerida: 15 min). Em **Auth → Configuration**:
   - adicione o domínio de produção (URL da Vercel) em *Trusted domains* (localhost já é permitido);
   - **desative o cadastro por e-mail/senha** (*Email & Password → Allow sign up*) e o login Google se não for usar.
     O painel já exige e-mail verificado + allowlist, mas desligar reduz a superfície.
   - e-mail: o remetente compartilhado serve para desenvolvimento; para produção configure um provedor próprio.
6. `npm run dev` → http://localhost:3000.

## App no Portal de Parceiros da Nuvemshop

1. Crie uma conta em https://partners.nuvemshop.com.br e um **app** (tipo privado / para sua própria loja).
2. **URL de redirecionamento (callback):** `https://SEU-APP.vercel.app/api/nuvemshop/callback`
   (para testes locais use um túnel HTTPS; a Nuvemshop exige HTTPS).
3. **Permissões (scopes):** `read_products` e `write_products`.
4. Copie o *App ID* (`NUVEMSHOP_APP_ID`), *Client ID* e *Client Secret* para as variáveis de ambiente.
5. **URLs de webhooks de LGPD** (Portal de Parceiros → seu app):
   - `store/redact` → `https://SEU-APP.vercel.app/api/nuvemshop/webhooks/store-redact` (apaga os dados da loja; exige assinatura HMAC válida)
   - `customers/redact` → `https://SEU-APP.vercel.app/api/nuvemshop/webhooks/customers-redact`
   - `customers/data_request` → `https://SEU-APP.vercel.app/api/nuvemshop/webhooks/customers-data-request`
   O app não guarda dados de clientes finais, então os dois últimos só respondem 200.
6. Instale o app na loja e, no painel INuvem, clique em **Conectar loja Nuvemshop**.
7. **Nunca** cole o Client Secret em chats/commits. Se vazar, regenere no Portal e atualize a variável na Vercel.

## Deploy na Vercel (plano Hobby)

1. Importe o repositório; framework Next.js (padrão).
2. Cadastre **todas** as variáveis de `.env.example` em *Settings → Environment Variables* (inclua `APP_URL` com a URL final).
3. **Cron:** `vercel.json` agenda `GET /api/cron/sync` uma vez por dia (07:00 UTC) — o máximo do plano Hobby.
   A Vercel envia `Authorization: Bearer $CRON_SECRET`; a rota rejeita qualquer outra chamada.
   Entre os crons, o botão **Sincronizar agora** faz o incremental sob demanda (e os webhooks, quando entrarem, mantêm o espelho em tempo real).
4. As rotas de sync usam `maxDuration = 60` e processam em lotes (`SYNC_TIME_BUDGET_MS`, padrão 20 s), retomando de onde pararam.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (inclui migrations e sync em Postgres WASM/pglite) |
| `npm run db:migrate` | aplica `db/migrations/*.sql` pendentes |
| `npm run db:seed-admin -- email` | libera um e-mail no painel |

## Pontos da documentação que ainda NÃO consegui confirmar

Marcados no código como "a confirmar". Validar com a documentação oficial / uma chamada real antes de depender deles:

1. **Versão da API na URL.** Usei `/v1/{store_id}` como pedido; a Nuvemshop também publica versões datadas. Configurável em `NUVEMSHOP_API_VERSION`.
2. **Semântica de `x-rate-limit-reset`.** Tratado como milissegundos de espera; é limitado a 30 s.
3. **Listagem vazia / página além da última** pode responder 404; tratado como lista vazia.
4. **URL de autorização OAuth** (`https://www.nuvemshop.com.br/apps/{APP_ID}/authorize`) e se o parâmetro `state` é devolvido no callback.
   Se não for, o callback depende só da sessão de admin (já exigida).
5. **Payload de `PATCH /products/stock-price`** (campos `stock` x `inventory_levels`, limite por chamada) — Fase 4.
6. **Upload de imagens** (`src` por URL pública x base64) e como reordenar — Fase 3.
7. **Assinatura HMAC dos webhooks**: assumi o header `x-linkedstore-hmac-sha256` (HMAC-SHA256 do corpo bruto com o client secret; aceita hex ou base64).
   Também a forma exata do payload de LGPD (usei apenas `store_id`) e se esses webhooks vêm assinados. `store-redact` falha fechado (401) sem assinatura válida.
8. **Endpoint de dados da loja** (nome/URL) — não consumido ainda; `stores.name` e `stores.url` ficam vazios.
9. **Magic link no servidor** (`auth.signIn.magicLink`) existe nos tipos do SDK `@neondatabase/auth@0.5.0-beta`
   (versão beta), mas o envio real do e-mail não foi testado fora do seu ambiente.
