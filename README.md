# CorvoQuiz Produção — V0.6.5

Painel visual de pré-produção com três especialistas via **Corvo Bridge**, retorno genérico por **GPT Action** e coleta de imagens pelo **Corvo Collector**.

## Fluxo completo sem redirecionamento

1. O app cria um trabalho com `POST /api/corvo/job`.
2. O Corvo Bridge escolhe o GPT de ideias, roteiro ou prompts e abre/reutiliza sua aba inativa.
3. A mensagem enviada ao GPT já contém a solicitação completa e o `JOB_ID`.
4. Ao terminar, o GPT chama `entregarResultadoCorvo` em `POST /api/corvo/resultado`, enviando `jobId + resultado`.
5. O modal acompanha `GET /api/corvo/resultado?jobId=...` e preserva o resultado integral.
6. A produção segue por `IDEIA → ROTEIRO → PROMPTS → IMAGENS`, sempre com revisão, nova tentativa ou aprovação.
7. Quando o app confirma o resultado, o Bridge fecha automaticamente apenas a aba do GPT que ele próprio abriu.

## Memória de cada produção

Cada projeto mantém a ideia escolhida, o roteiro completo e os prompts de imagem no armazenamento do app. Os três conteúdos ficam disponíveis no painel **Memória da produção**, com visualização, cópia e download em TXT. O ZIP do projeto também inclui a pasta `ideia`, além de `roteiro` e `prompts`.

## Refazer etapas aprovadas

Qualquer conteúdo da **Memória da produção** pode ser enviado novamente ao especialista correspondente. O app invalida automaticamente somente os arquivos dependentes:

- refazer `PROMPTS` remove o pacote de imagens e volta para a aprovação dos prompts;
- refazer `ROTEIRO` remove roteiro, prompts e imagens anteriores; ao aprovar o novo roteiro, os prompts são refeitos;
- refazer `IDEIA` abre novas opções no mesmo projeto e, depois da escolha, reinicia roteiro, prompts e imagens.

O botão **Pedir outro** dos modais usa a mesma regra de segurança, impedindo a mistura de arquivos de versões diferentes da produção.

O app não redireciona para o ChatGPT e não precisa de `OPENAI_API_KEY`.

## Motor do Corvo Collector

Em **Configurações → Motor do coletor**, escolha entre:

- **Google Imagens** — todas as candidatas vêm do Google Imagens;
- **Pinterest** — todas as candidatas vêm do Pinterest;
- **Mesclado** — divide a quantidade de candidatas entre Google Imagens e Pinterest e reúne os resultados.

A opção fica salva no navegador, aparece no cartão de busca da produção e é enviada ao Collector tanto na busca inicial quanto em **Procurar mais**. O padrão para uma instalação nova é **Mesclado**.

## Produções longas e reconexão

A espera da coleta não possui mais o limite global de aproximadamente três minutos. O painel acompanha o job até `DONE`, mesmo em produções com 70, 100 ou mais imagens, e mostra quantidade concluída, posição atual e tempo decorrido.

Se a comunicação oscilar, o app continua tentando se reconectar sem encerrar o trabalho. Ao abrir a etapa novamente, ele reconhece uma busca compatível que já esteja rodando e volta a acompanhá-la em vez de criar outro job. O botão `×` apenas oculta a janela; a interrupção exige o botão explícito **Cancelar busca**.

## Cleaner integrado ao Corvo Bridge

O pacote inclui o **Corvo Bridge V0.5.1**, que registra as conversas técnicas concluídas e pode limpá-las diariamente no horário escolhido.

- o Cleaner começa desativado;
- o **Modo Teste** começa ativado e apenas informa o que seria removido;
- somente conversas executadas em abas pertencentes ao Bridge são elegíveis;
- abas compatíveis abertas manualmente podem ser reutilizadas para envio, mas nunca entram na limpeza;
- apenas jobs confirmados como `DONE` podem ser candidatos;
- a execução manual sem Modo Teste exige confirmação adicional;
- exclusões reais são permanentes.

Configure em **Corvo Bridge → Configurações → Limpeza automática**. Faça primeiro alguns jobs mantendo o Modo Teste marcado.

## Configurar a Vercel

1. Configure `CorvoAPI_KEY_IDEIA` com um segredo forte.
2. No Marketplace da Vercel, conecte um banco **Upstash Redis** ao projeto.
3. Confirme que existe um par completo: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` ou `KV_REST_API_URL` + `KV_REST_API_TOKEN`.
4. Faça um novo deploy.

Sem Redis, o app usa memória apenas no desenvolvimento local. Em produção a rota informa claramente que o armazenamento precisa ser conectado.

O armazenamento usa o SDK oficial `@upstash/redis`. O cliente é criado de forma lazy com `new Redis({ url, token })`, priorizando o par `UPSTASH_*` e usando `KV_*` como fallback. Cada job é salvo como objeto em `corvoquiz:idea-job:<jobId>` e expira após uma hora.

`GET /api/corvo/diagnostico` retorna apenas `{ "configured": true }` ou `{ "configured": false }`. A rota nunca devolve nomes resolvidos, URL ou token.

## Configurar o GPT personalizado

1. Na mesma Action já existente para `roteiro-mu.vercel.app`, substitua o schema pelo conteúdo de `CORVOQUIZ_OPENAPI_GPT_ACTION.yaml`. Não crie outra Action para o mesmo domínio.
2. Configure autenticação por API key personalizada no cabeçalho `x-api-key`, com o mesmo valor de `CorvoAPI_KEY_IDEIA`.
3. Cole no GPT o bloco de `INSTRUCOES_GPT_CORVO_BRIDGE.md`.
4. Teste `entregarResultadoCorvo` com um `jobId` criado pelo app e um texto preenchido no campo `resultado`.

## Instalar as extensões

### Corvo Bridge

1. Extraia `corvo-bridge-extension`.
2. Abra `chrome://extensions`, ative **Modo do desenvolvedor** e clique em **Carregar sem compactação**.
3. Selecione a pasta da extensão.
4. Abra as opções e cadastre as URLs dos GPTs de ideias, roteiro e prompts de imagem.
5. Salve. Cada trabalho será encaminhado automaticamente ao especialista correto.

### Corvo Collector

1. Carregue `corvo-collector-extension` da mesma forma.
2. No popup, autorize a origem exata do site.

## Publicar

Envie o conteúdo deste projeto a um repositório do GitHub e importe-o no Vercel. O app usa Next.js e não exige configuração extra de framework.

## Downloads dentro do app

O menu de configurações oferece downloads diretos de três pacotes publicados em `public/downloads`:

- Corvo Collector V0.7.4 — somente a extensão de imagens;
- Corvo Bridge V0.5.1 — três GPTs, fechamento automático da aba e Cleaner protegido;
- Kit completo CorvoQuiz — app, extensões, schema e instruções.
