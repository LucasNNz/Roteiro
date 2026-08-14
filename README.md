# CorvoQuiz Produção — V0.5.2

Painel visual de pré-produção com geração de ideias via **Corvo Bridge**, retorno por **GPT Action** e coleta de imagens pelo **Corvo Collector**.

## Fluxo de ideias sem redirecionamento

1. O app cria um trabalho com `POST /api/corvo/job`.
2. O Corvo Bridge abre ou reutiliza o GPT personalizado em uma aba inativa.
3. O GPT chama `buscarSolicitacao` em `GET /api/corvo/ideia?jobId=...`.
4. Ao terminar, o GPT chama `entregarResultado` em `POST /api/corvo/resultado`.
5. O modal acompanha `GET /api/corvo/resultado?jobId=...` e mostra as quatro ideias assim que o trabalho termina.

O app não redireciona para o ChatGPT e não precisa de `OPENAI_API_KEY`.

## Configurar a Vercel

1. Configure `CorvoAPI_KEY_IDEIA` com um segredo forte.
2. No Marketplace da Vercel, conecte um banco **Upstash Redis** ao projeto.
3. Confirme que foram criadas `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`. Os nomes antigos `KV_REST_API_URL` e `KV_REST_API_TOKEN` também são aceitos.
4. Faça um novo deploy.

Sem Redis, o app usa memória apenas no desenvolvimento local. Em produção a rota informa claramente que o armazenamento precisa ser conectado.

O armazenamento dos trabalhos usa o SDK oficial `@upstash/redis`. O cliente é criado de forma lazy com `Redis.fromEnv()` somente quando as duas variáveis REST estão disponíveis. Cada job é salvo como objeto em `corvoquiz:idea-job:<jobId>` e expira automaticamente após uma hora.

## Configurar o GPT personalizado

1. Na mesma Action já existente para `roteiro-mu.vercel.app`, substitua o schema pelo conteúdo de `CORVOQUIZ_OPENAPI_GPT_ACTION.yaml`. Não crie outra Action para o mesmo domínio.
2. Configure autenticação por API key personalizada no cabeçalho `x-api-key`, com o mesmo valor de `CorvoAPI_KEY_IDEIA`.
3. Cole no GPT o bloco de `INSTRUCOES_GPT_CORVO_BRIDGE.md`.
4. Teste primeiro `buscarSolicitacao` e depois `entregarResultado` com o mesmo `jobId` criado pelo app.

## Instalar as extensões

### Corvo Bridge

1. Extraia `corvo-bridge-extension`.
2. Abra `chrome://extensions`, ative **Modo do desenvolvedor** e clique em **Carregar sem compactação**.
3. Selecione a pasta da extensão.
4. Abra as opções, cole a URL exata do GPT personalizado e salve.

### Corvo Collector

1. Carregue `corvo-collector-extension` da mesma forma.
2. No popup, autorize a origem exata do site.

## Publicar

Envie o conteúdo deste projeto a um repositório do GitHub e importe-o no Vercel. O app usa Next.js e não exige configuração extra de framework.

## Downloads dentro do app

O menu de configurações oferece downloads diretos de três pacotes publicados em `public/downloads`:

- Corvo Collector V0.7.4 — somente a extensão de imagens;
- Corvo Bridge V0.2 — somente a extensão do GPT;
- Kit completo CorvoQuiz — app, extensões, schema e instruções.
