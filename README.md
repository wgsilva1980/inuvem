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
  (enviar arquivo, remover, reordenar, tornar principal): validação, detecção de alteração por fora, espelho e `audit_log`.
- `lib/bulk/` — operações em massa (Fase 4): `operations.ts` calcula a pré-visualização (antes → depois, o que fica de fora e por quê),
  `repo.ts` guarda o lote e os itens (`bulk_jobs`, `bulk_job_items`), `engine.ts` aplica em passos curtos e retomáveis e reverte.
  Fluxo: escolher produtos na lista → configurar a operação → **pré-visualizar (nada vai à loja)** → confirmar → aplicar (cada produto é
  conferido na loja antes de alterar; se mudou, fica de fora como "conflito") → opcionalmente **reverter o lote**.
- `lib/categories/` — categorias (Fase 5): árvore, criar/renomear/mover/apagar com regras (sem ciclos, sem nome repetido no mesmo nível,
  não apaga categoria com subcategorias), detecção de alteração por fora e `audit_log`.
- `lib/dashboard/` e `lib/history/` — indicadores do painel inicial (cada "ponto de atenção" abre a lista de produtos já filtrada) e o
  histórico pesquisável das alterações (`audit_log` com o nome do que mudou).
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

## Segurança (revisão da Fase 5)

Modelo: painel privado de uma loja só. O navegador nunca fala com a Nuvemshop nem com o banco; tudo passa pelo servidor.

**Autorização em camadas**
1. `proxy.ts` exige sessão em tudo, exceto rotas com autenticação própria (webhooks com HMAC, cron/health com `CRON_SECRET`, login, OAuth).
   Cada exceção vale só para o caminho exato (`/login` sim, `/login-qualquer-coisa` não).
2. **Cada página, Server Action e rota de API chama `requireAdmin()`/`requireAdminApi()`** (sessão + e-mail verificado + lista `admins`).
   Não dependemos do layout: o Next pode renderizar uma página sem rodar o layout.
3. Segredos do app e da loja só no servidor (`server-only`); o token da Nuvemshop fica criptografado (AES-256-GCM) e nunca é logado.

**Entradas**
- SQL sempre parametrizado (os trechos dinâmicos são fragmentos fixos do código; limites são números internos).
- Descrição HTML sanitizada no servidor quando editada; upload de imagem confere o conteúdo real (bytes iniciais), não o tipo declarado.
- Webhooks: HMAC-SHA256 do corpo bruto com comparação em tempo constante; `store-redact` (destrutivo) também exige assinatura.
- OAuth: `state` em cookie `HttpOnly`; o callback exige sessão de admin e **não aceita trocar a loja já conectada**.

**Abuso e navegador**
- Rotas POST chamadas pela tela recusam requisições de outro site (`Origin`/`Sec-Fetch-Site`), além do cookie de sessão `SameSite=Lax`.
- Pedido de link de acesso limitado por IP (5 por 15 min) e no total (30 por hora), para ninguém encher a caixa do administrador nem esgotar a cota de envio de e-mail.
- Cabeçalhos: `X-Frame-Options: DENY` e `frame-ancestors 'none'` (clickjacking), `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS.
  Não há `script-src` de propósito (o Next injeta scripts em linha); fechar isso exigiria nonces.

**Sua parte (não dá para fazer pelo código)**
- Rotacionar `CRON_SECRET` e o Client Secret da Nuvemshop se algum dia foram colados em chat, e-mail ou tela compartilhada.
- No Neon Console → Auth: manter o cadastro de novos usuários desligado e, se não usa login com Google, **remover o provedor Google**
  (com ele ativo, qualquer conta Google poderia criar um usuário no Neon Auth; o painel ainda recusaria por não estar em `admins`, mas é uma porta a menos).
- Manter a lista `admins` só com quem deve ter acesso (`npm run db:seed-admin -- email`).
- `ENCRYPTION_KEY`: guardar uma cópia segura; trocá-la exige reconectar a loja (o formato `v1.` já permite versionar a chave no futuro).

## Pontos da documentação que ainda NÃO consegui confirmar

Marcados no código como "a confirmar". Validar com a documentação oficial / uma chamada real antes de depender deles:

1. **Versão da API na URL.** Usei `/v1/{store_id}` como pedido; a Nuvemshop também publica versões datadas. Configurável em `NUVEMSHOP_API_VERSION`.
2. **Semântica de `x-rate-limit-reset`.** Tratado como milissegundos de espera; é limitado a 30 s.
3. **Listagem vazia / página além da última** pode responder 404; tratado como lista vazia.
4. **URL de autorização OAuth** (`https://www.nuvemshop.com.br/apps/{APP_ID}/authorize`) e se o parâmetro `state` é devolvido no callback.
   Se não for, o callback depende só da sessão de admin (já exigida).
5. **Payload de `PATCH /products/stock-price`** (campos `stock` x `inventory_levels`, limite por chamada) — Fase 4.
6. **Imagens (Fase 3).** `POST /products/{id}/images` (envio por arquivo; o painel não envia imagem por URL), `DELETE .../images/{id}` e, para reordenar,
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
10. **Descrição (editor visual).** O HTML enviado é limpo no servidor (`sanitize-html`): só formatação de texto, links https/mailto/tel, imagens https e tabelas;
   estilos só de cor e alinhamento. Uma descrição que ninguém editou segue idêntica à da loja (não é reescrita nem limpa). Não confirmei
   quais tags a Nuvemshop aceita/remove na vitrine; se algum elemento sumir depois de salvar, ajustar a lista em `lib/catalog/description.ts`.
11. **Operações em massa.** Aplico cada alteração com os mesmos `PUT /products/{id}` e `PUT /products/{id}/variants/{id}` já usados na edição
   individual (1 leitura + 1 escrita por produto/variante), e não o `PATCH /products/stock-price` (formato não confirmado). Custo: ~2 chamadas por
   variante, no limite de 2 req/s por loja; um lote de ~190 produtos leva alguns minutos, em passos de até 30 s.
12. **Categorias (Fase 5).** `POST /categories` com `name` e `parent`, `PUT /categories/{id}` com `name`/`parent` e `DELETE`. Para mover uma
   categoria para a raiz envio `parent: null` (a API pode esperar outro valor, por exemplo `0`); se a loja recusar, a mensagem aparece na
   tela e o histórico guarda a resposta. Também não confirmei o que a Nuvemshop faz com os produtos de uma categoria apagada (o painel
   tira a categoria deles no espelho e os webhooks confirmam).
13. **Webhooks de produtos e categorias.** Nomes dos eventos (`product/created|updated|deleted`, `category/created|updated|deleted`),
   corpo `{ store_id, event, id }`, `POST /webhooks` com `{ event, url }` e o header de assinatura (item 7). Como o corpo não traz hora nem
   id de entrega, a deduplicação só descarta repetições em até 3 s; o processamento é idempotente (busca o estado atual e regrava).
   Se todas as entregas forem recusadas com 401, o nome do header de assinatura está errado (o log `webhook.rejected` mostra se ele veio).
14. **Magic link no servidor** (`auth.signIn.magicLink`) existe nos tipos do SDK `@neondatabase/auth@0.5.0-beta`
   (versão beta), mas o envio real do e-mail não foi testado fora do seu ambiente.
15. **Gerenciar variações (não testado na loja real).** O painel edita os valores de cada variante (`PUT /products/{id}/variants/{id}`
   com `values`, uma lista de `{ pt }` com um item por propriedade, na ordem de `attributes`) e o peso (`weight`, em kg; esvaziar envia
   `null`), cria variantes (`POST /products/{id}/variants`) e exclui (`DELETE`), e renomeia as propriedades (`PUT /products/{id}` com
   `attributes`). A confirmar: se `values` pode ser trocado por `PUT` numa variante existente, se `weight: null` é aceito, se a loja recusa
   excluir a última variante (o painel já impede), e se renomear uma propriedade pelo produto mantém os valores das variantes. Depois de
   cada operação o painel rebusca o produto e regrava o espelho, então a tela sempre mostra o estado real. **Fora de escopo por enquanto:**
   adicionar ou remover uma propriedade (ex.: passar a ter Cor e Tam), pois isso exige reescrever os valores de todas as variantes de uma vez.
16. **Lote "Padronizar propriedades (COR e TAMANHO)" (não testado na loja real).** Usa o mesmo `PUT /products/{id}` com `attributes`
   do item 15, em lote: renomeia as duas propriedades para COR e TAMANHO (reconhece "Cor", "COR", "Tam", "Tamanho", "CORES", "TAMAMHO"
   etc., ignorando caixa, acento e vírgula sobrando). Cada produto é conferido contra a loja antes de aplicar e o lote pode ser revertido
   (volta aos nomes anteriores). Ficam de fora, com o motivo na pré-visualização: produtos já no padrão, com a ordem invertida (TAMANHO
   antes de COR, pois os valores das variantes seguem a ordem das propriedades), com uma só propriedade, sem propriedades, com três ou
   mais, ou com nomes não reconhecidos. Na auditoria de 04/10/2026: 111 de 188 produtos seriam renomeados e 77 ficariam de fora.
17. **Lote "Padronizar grafia dos valores" (não testado na loja real).** Reescreve os valores das variantes com `PUT /products/{id}/variants/{id}`
   e `values` (mesmo ponto do item 15: se a loja aceita trocar `values` numa variante existente). Regras fixas, por nome da propriedade
   (COR/Cor/CORES e TAM/Tamanho, em qualquer ordem): **cores** com inicial maiúscula em cada palavra, mantendo "de, da, do, e, com, em" em
   minúsculas ("Verde de Água", "Preto com Branco"); **tamanhos** em maiúsculas, com "UNICO/Único/único" virando "ÚNICO". Tamanhos não usam
   inicial maiúscula para não virar "Pp"/"Gg". Outras propriedades não mudam. O produto inteiro fica de fora se duas variantes ficariam com a
   mesma combinação de valores. Cada produto é conferido contra a loja e o lote pode ser revertido. Na auditoria de 04/10/2026: 409
   variantes em 130 produtos mudariam, e nenhum produto teria variantes repetidas.
18. **Lote "Corrigir a ordem das propriedades" (não testado na loja real).** Para produtos com TAMANHO antes de COR: coloca COR e depois
   TAMANHO (`PUT /products/{id}` com `attributes`) e troca os dois valores de cada variante (`PUT .../variants/{id}` com `values`), levando
   junto os outros idiomas. Como são várias chamadas por produto, este lote é **tudo ou nada**: se uma etapa falhar, ou se, depois de
   aplicar, o painel reler o produto e a loja não estiver como esperado, ele desfaz o que já aplicou com os objetos originais da loja e
   mostra o resultado. Se nem o desfazer for aceito, o item mostra "ATENÇÃO" com o que ficou para conferir na loja. Na auditoria de
   04/10/2026: 14 produtos e 43 variantes, e em todos o primeiro valor de cada variante é um tamanho e o segundo uma cor. Ponto a confirmar:
   se a loja aceita reordenar `attributes` e trocar `values` em sequência (ver itens 15 a 17).
19. **Lote "Completar COR e TAMANHO" (não testado na loja real).** Para produtos com só uma das propriedades, ou nenhuma: acrescenta COR
   e/ou TAMANHO (sempre nessa ordem) e coloca o valor que **o usuário digita na tela** em todas as variantes do produto (a loja não tem como
   saber a cor ou o tamanho). O que o produto já tinha é mantido, com os outros idiomas. Usa `PUT /products/{id}` com `attributes` e
   `PUT .../variants/{id}` com `values`, no mesmo esquema tudo ou nada do item 18 (confere depois de aplicar e desfaz se algo falhar). A
   reversão volta ao estado anterior, inclusive a "sem propriedades" (`attributes: []` e `values: []`). Pontos a confirmar: se a loja aceita
   acrescentar uma propriedade com a lista de valores das variantes ainda com o tamanho antigo entre uma chamada e outra (se recusar na
   primeira chamada, nada muda e o item mostra o motivo), e se `attributes: []` é aceito ao desfazer. Produtos sem nome na loja (o painel
   mostra "Produto <id>") ficam fora da lista da tela. Na auditoria de 04/10/2026: 10 produtos (3 sem propriedades, 6 só com tamanho,
   1 só com cor), 11 variantes.
20. **Cadastrar produtos (não testado na loja real).** Tela "Novo produto" (botão na lista de Produtos): nome, descrição (editor, limpa como na
   edição), tags, categorias, SEO e "Publicar na loja agora" (desmarcado = rascunho). Dois modos: **produto simples** (uma variante com preço,
   promocional, SKU, peso e estoque) ou **cores e tamanhos** (o usuário digita as cores e os tamanhos; o painel monta uma variante por
   combinação, com as propriedades COR e TAMANHO, grafia padronizada, e preço/estoque padrão ajustáveis por variante; até 60 variantes). Envia
   `POST /products` com `attributes` e `variants` (cada uma com `values`) numa chamada só. Pontos a confirmar: se a loja aceita `attributes`
   e `variants` aninhados na criação, e se gera o `handle` sozinha a partir do nome. As **fotos** não vão na criação: depois de criar, o painel
   abre a tela do produto, onde o painel de imagens já existe. Depois de criar, o espelho é gravado com a resposta da loja, e o histórico
   registra "Produto criado" (também quando a loja recusa).

21. **Salvar tudo junto e excluir produto (não verificado na loja real).** O botão “Salvar na Nuvemshop” salva dados do produto, nomes das propriedades e todas as variantes alteradas (cada uma com a própria checagem de conflito; falhas aparecem por item e o que deu certo fica salvo). Criar e excluir variante continuam imediatos. “Excluir produto” usa `DELETE /products/{id}` (irreversível, exige digitar o nome); um 404 da loja só limpa o espelho. Confirme em um produto de teste que a exclusão remove variantes e imagens.
22. **Excluir produtos em lote (não verificado na loja real).** Operação "Excluir produtos" no lote: pré-visualização com a lista inteira, confirmação digitando EXCLUIR, `DELETE /products/{id}` por produto (com conferência do nome; renomeado = conflito, 404 = já excluído), espelho e histórico atualizados. Não pode ser revertido. Teste primeiro com 1 produto.
23. **SKU automático e lote "Ajustar SKUs" (não verificado na loja real).** Produto novo e variante nova com SKU em branco recebem o próximo número (maior SKU numérico do espelho + 1; digitados são respeitados). O lote "Ajustar SKUs" numera variantes sem código e renumera repetidos (a variante mais antiga fica com o código); códigos únicos não mudam; pode ser revertido. A numeração usa o espelho: sincronize antes de lotes grandes e não crie produtos em paralelo. Confirme que `PUT /products/{id}/variants/{id}` aceita `sku` (e que a loja não rejeita SKU repetido).
24. **Medidas e Google Shopping na variante (não verificado na loja real).** Cada variante ganhou comprimento/largura/altura (cm, enviados como `depth`/`width`/`height`), MPN, faixa etária (`newborn`, `infant`, `toddler`, `kids`, `adult`) e sexo (`female`, `male`, `unisex`), na edição e na criação de variante, salvos pelo botão único. Campos conforme a documentação pública; confirme com 1 variante. **"Mostrar esta variação na loja"** não foi implementado: a API pública não documenta esse campo na variante. O cadastro de produto novo ainda só pede o peso.
25. **Padrão Adulto / Feminino (não verificado na loja real).** Produto novo e variante nova saem com faixa etária `adult` e sexo `female` (o formulário já vem selecionado; o servidor aplica o padrão se vier vazio). Para as variantes existentes há o lote "Preencher faixa etária e sexo", que só preenche o que está vazio e pode ser revertido.
26. **Tela "Usuários".** Lista, adiciona e remove e-mails da tabela `admins` (quem pode entrar no painel). Todos têm acesso total; não dá para remover a si mesmo nem o último usuário; adicionar/remover vai para o histórico. O login continua por link no e-mail verificado (o `npm run db:seed-admin` segue valendo).
27. **Contatos (clientes e fornecedores).** Tabela `contacts` (migration 0005) por loja, com tela em `/contatos`: busca (nome, e-mail, telefone, CPF/CNPJ, cidade), filtro por tipo (cliente, fornecedor, contador, desenvolvedor, sem tipo) e situação, cadastro, edição e exclusão. Os dados são pessoais (CPF, nascimento): o histórico guarda só o nome e os *nomes* dos campos alterados, nunca os valores. A planilha `contatos_2026-10-05` (290 registros) foi importada à parte, direto no banco (a planilha não vai para o repositório); datas `01/01/1970` da planilha foram tratadas como "sem data". Não há tela de importação: para reimportar, a coluna `external_id` evita duplicar.
28. **Login por código de 6 dígitos (não verificado com o serviço real).** A tela de login passou a pedir um código por e-mail (`emailOtp.sendVerificationOtp` + `signIn.emailOtp`), mantendo "Prefiro receber um link" como alternativa. O código não é gasto por verificadores de link do e-mail (Outlook/Hotmail) nem depende de abrir no mesmo navegador. O envio (link e código) e a digitação do código têm limite por IP em `/api/auth`. Se o serviço Neon Auth não tiver o e-mail OTP habilitado, a tela mostra "Não foi possível enviar agora" e o link segue funcionando.
29. **Padronização de imagens — Fase 0: teste de formato (não rodado na loja real).** Página `/imagens/teste` (sem link no menu): cria um produto de teste *não publicado*, envia a mesma imagem 1200×1200 em JPEG e em WebP, confere as versões de 50 a 1024 px na CDN e apaga o produto. Motivo: a documentação da Nuvemshop diz que, para imagens enviadas em WebP, só existe a versão JPEG de 1024 px. O resultado decide o formato do padrão (hoje a recomendação é JPEG). Usa `sharp` no servidor (também será a base da padronização). Plano completo: 1200×1200 (peça solta, 1:1) e 1080×1350 (modelo, 4:5), fundo em tom suave, JPEG de alta qualidade com no máximo 500 KB, originais guardadas para desfazer.