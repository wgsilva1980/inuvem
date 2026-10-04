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
- `lib/catalog/` — catálogo (Fase 2): consulta com filtros sobre o espelho (`query.ts`), regras de edição (`edit.ts`) e o
  salvamento (`update.ts`): confere conflito com a loja, envia só os campos alterados, atualiza o espelho e grava em `audit_log`.
- `lib/catalog/variants.ts`, `update-variant.ts`, `images.ts` — edição de variantes (SKU, preço, promocional, estoque) e de imagens
  (adicionar por URL, remover, reordenar): validação, detecção de alteração por fora, espelho e `audit_log`.
- `lib/webhooks/` — webhooks de produtos e categorias (`/api/webhooks/nuvemshop`, público, autenticado por HMAC): busca o estado
  atual na API e atualiza o espelho; registro idempotente dos eventos (`register.ts`), acionado pelo botão "Registrar webhooks" no painel.
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

## Verificar a configuração

- **Variáveis (local ou baixadas da Vercel):** `npm run check:env` valida `.env.local`; para a Vercel use
  `vercel env pull .env.vercel` e depois `npm run check:env -- .env.vercel`. Mostra só nomes e problemas (ausente, inválida,
  valor de exemplo, chave de criptografia que não tem 32 bytes), nunca valores.
- **Deploy no ar:** `GET /api/health` com `Authorization: Bearer <CRON_SECRET>` confere variáveis, conexão com o banco,
  migrations aplicadas, admins liberados e acesso ao Neon Auth. Responde 200 quando tudo está ok.
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://SEU-APP.vercel.app/api/health
  ```
  (URLs de prévia podem exigir o login da Vercel antes; use o domínio de produção.)

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (inclui migrations e sync em Postgres WASM/pglite) |
| `npm run db:migrate` | aplica `db/migrations/*.sql` pendentes |
| `npm run db:seed-admin -- email` | libera um e-mail no painel |
| `npm run check:env [-- arquivo]` | valida as variáveis de ambiente |

## Pontos da documentação que ainda NÃO consegui confirmar

Marcados no código como "a confirmar". Validar com a documentação oficial / uma chamada real antes de depender deles:

1. **Versão da API na URL.** Usei `/v1/{store_id}` como pedido; a Nuvemshop também publica versões datadas. Configurável em `NUVEMSHOP_API_VERSION`.
2. **Semântica de `x-rate-limit-reset`.** Tratado como milissegundos de espera; é limitado a 30 s.
3. **Listagem vazia / página além da última** pode responder 404; tratado como lista vazia.
4. **URL de autorização OAuth** (`https://www.nuvemshop.com.br/apps/{APP_ID}/authorize`) e se o parâmetro `state` é devolvido no callback.
   Se não for, o callback depende só da sessão de admin (já exigida).
5. **Payload de `PATCH /products/stock-price`** (campos `stock` x `inventory_levels`, limite por chamada) — Fase 4.
6. **Imagens (Fase 3).** `POST /products/{id}/images` com `src` por URL pública (base64 não usado), `DELETE .../images/{id}` e, para reordenar,
   `PUT .../images/{id}` com `position` (assumo que `position` é a posição de destino). Depois de cada operação o painel rebusca o produto,
   então a tela sempre mostra a ordem real da loja, mesmo se a regra de reposicionamento for diferente.
   **Upload de arquivo:** `POST .../images` com `attachment` (base64) e `filename`. O arquivo passa pelo servidor do painel (limite de 4,5 MB
   por requisição na Vercel): fotos maiores que 3,5 MB são reduzidas no navegador (JPEG, até 2400 px) antes do envio; o limite final é 4 MB.
   **Foto da variação:** campo `image_id` da variante (id de uma imagem do produto), enviado no `PUT` da variante.
   **Variantes (Fase 3):** `PUT /products/{id}/variants/{id}` com `sku`, `price`, `promotional_price`, `stock_management` e `stock`
   (`stock: null` = ilimitado; loja sem multi-estoque, então não uso `inventory_levels`).
7. **Assinatura HMAC dos webhooks**: assumi o header `x-linkedstore-hmac-sha256` (HMAC-SHA256 do corpo bruto com o client secret; aceita hex ou base64).
   Também a forma exata do payload de LGPD (usei apenas `store_id`) e se esses webhooks vêm assinados. `store-redact` falha fechado (401) sem assinatura válida.
8. **Endpoint de dados da loja** (nome/URL) — não consumido ainda; `stores.name` e `stores.url` ficam vazios.
9. **Edição de produto (Fase 2).** `PUT /products/{id}` com corpo parcial (só os campos alterados), `categories` como lista de IDs,
   campos multi-idioma como `{ "pt": "..." }`, e o comportamento de `updated_at`: na loja real ele **não avança** com edições, então a detecção de alteração por fora compara o conteúdo editável (não a data).
   `images[].alt` chega como objeto multi-idioma na loja real (a documentação mostra lista); o schema aceita as duas formas.
10. **Webhooks de produtos e categorias.** Nomes dos eventos (`product/created|updated|deleted`, `category/created|updated|deleted`),
   corpo `{ store_id, event, id }`, `POST /webhooks` com `{ event, url }` e o header de assinatura (item 7). Como o corpo não traz hora nem
   id de entrega, a deduplicação só descarta repetições em até 3 s; o processamento é idempotente (busca o estado atual e regrava).
   Se todas as entregas forem recusadas com 401, o nome do header de assinatura está errado (o log `webhook.rejected` mostra se ele veio).
11. **Magic link no servidor** (`auth.signIn.magicLink`) existe nos tipos do SDK `@neondatabase/auth@0.5.0-beta`
   (versão beta), mas o envio real do e-mail não foi testado fora do seu ambiente.
