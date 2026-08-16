# CorvoQuiz Produção — V0.6.35

## V0.6.35 — migração automática de checkpoints Vercel Blob → R2

- Detecta projetos/checkpoints antigos que ainda apontam para `*.blob.vercel-storage.com`.
- Não fica mais tentando enviar um ZIP legado para o Bridge.
- Descarta somente o checkpoint de arquivos antigo e refaz a embalagem no R2; o Collector reaproveita o resultado já concluído quando ainda estiver disponível na extensão.
- `GET /api/corvo/checkpoint` informa `legacyStorage` e `storageProvider`.
- `/api/corvo/download` retorna `LEGACY_VERCEL_BLOB_CHECKPOINT` para referências antigas.
- `/api/corvo/diagnostico` executa probe real do R2 antes de permitir o pipeline pesado.


- O Vercel Blob deixa de ser usado como armazenamento operacional do pipeline.
- Cloudflare R2 passa a armazenar lotes do Collector, ZIP do Analista, imagens refinadas/geradas, thumbnail e checkpoints físicos.
- O bucket pode permanecer privado; o servidor gera URLs GET assinadas temporárias e o Bridge mantém `/api/corvo/download` como fallback autenticado.
- A implementação usa somente APIs HTTP/S3 compatíveis e `node:crypto`; não adiciona SDK externo novo ao build.
- `GET /api/corvo/diagnostico` agora expõe `storageProvider=R2` e `storageConfigured`.
- Variáveis novas: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` e `R2_ENDPOINT`. O TTL assinado é opcional e usa 7 dias por padrão.
- Configure CORS do R2 para o app e o ChatGPT e uma regra de lifecycle para remover `corvoquiz/` após 7 dias.
- Corvo Bridge atualizado para **V0.6.20** e Collector permanece **V0.8.0**.
- O app usa o `R2_ENDPOINT` fornecido pela Cloudflare e `R2_BUCKET_NAME`; `R2_BUCKET` fica apenas como fallback legado.

## V0.6.32 — envio robusto ao Analista por microcheckpoint

- O envio ao Analista agora preserva e reutiliza o rascunho do mesmo `JOB_ID`.
- O Bridge distingue composer preenchido, anexo presente, controle de envio disponível, clique disparado, mensagem commitada e resposta iniciada.
- O timeout deixou de ser um cronômetro seco: cada progresso real renova a janela de espera, com limite absoluto de segurança.
- Se a mensagem já estiver no composer, o retry não reescreve o prompt; continua de onde parou.
- Se o ZIP já estiver anexado, o retry não o baixa/anexa novamente.
- A leitura de Blob usa origem autenticada no servidor e expõe erro estruturado caso a própria store recuse leitura.
- Corvo Bridge atual: **V0.6.20**. Collector permanece **V0.8.0**.

## V0.6.31 — proxy autenticado para anexos do Analista

- Corrige o diagnóstico `ATTACHMENT_FETCH_403`: o prompt chegava ao composer, mas o ZIP do Analista não podia ser lido diretamente do Blob pela página/extensão.
- Nova rota `GET /api/corvo/download` valida `JOB_ID` + `x-corvo-upload-token` e recupera o Blob no servidor com `@vercel/blob/get`.
- O Bridge V0.6.18 tenta leitura direta, depois o proxy do CorvoQuiz e mantém o background como fallback final.
- O ZIP continua sendo o mesmo artefato persistente do checkpoint; falha de transporte não refaz Collector, candidatas, lotes nem montagem do ZIP.
- O diagnóstico passa a registrar `ATTACHMENT_PROXY_FETCH_START/OK/FAIL`.

## V0.6.30 — handshake autorrecuperável do Analista

- Bridge V0.6.17 corrige o gap identificado pelo diagnóstico: aba reutilizada do GPT sem content script receptor.
- Ao detectar `Receiving end does not exist`, injeta o `chatgpt-bridge.js` automaticamente.
- Se necessário, recarrega a aba do GPT e aguarda novo handshake.
- ZIP/mensagem só começam depois de `PING_OK`.
- Checkpoint do Analista continua preservado durante a recuperação.

## V0.6.29 — diagnóstico completo do envio ao Analista

- Bridge V0.6.16 registra uma linha do tempo persistente por JOB_ID para descobrir exatamente onde o envio ao GPT quebra.
- O diagnóstico cobre abertura da aba, content script, composer, preenchimento, download do ZIP, descoberta do input de arquivo, dispatch do File, confirmação visual do anexo, descoberta/clique do botão de envio e confirmação do JOB_ID na conversa.
- O popup mostra quantos eventos foram registrados e o último evento.
- Botão **Copiar diagnóstico do último job** copia um TXT pronto para compartilhar.
- URLs são reduzidas a origem + caminho e campos sensíveis/tokens são removidos do log.
- Mantém o checkpoint V0.6.27/V0.6.28: uma falha diagnosticada no Analista não refaz Collector, lotes ou ZIP.





## V0.6.28 — confirmação real do envio ao Analista

- Corrige o gap em que o Bridge abria o GPT Analista em segundo plano, mas o ZIP/mensagem podiam nunca chegar ao editor.
- O Bridge V0.6.15 preenche a mensagem antes do anexo e confirma cada estado do envio.
- O anexo só é aceito quando o nome do ZIP aparece de fato no composer do ChatGPT.
- Inputs de arquivo são selecionados pelo contexto do composer; inputs globais/errados deixam de ser usados cegamente.
- Timeout de anexo agora gera erro estruturado e retry; não é ignorado.
- Em falhas de UI no segundo plano, o Bridge ativa temporariamente a aba do GPT e tenta novamente.
- A mensagem só vira ENVIADA quando o JOB_ID aparece numa mensagem real da conversa.
- App e Bridge aguardam até 12 minutos na fase de envio com anexo, evitando timeout prematuro em ZIPs maiores.
- A interface do app recebe os estados de envio e mostra BAIXANDO ZIP / ANEXANDO ZIP / ZIP ANEXADO / ENVIANDO MENSAGEM / MENSAGEM CONFIRMADA.
- O checkpoint fino da V0.6.27 permanece: qualquer falha nesta fase reutiliza o mesmo pacote persistente.
- Mantém Collector V0.8.0.


## V0.6.27 — checkpoint fino da preparação do Analista

- A preparação do Analista agora possui estados persistidos: `JOB_CREATED` → `CANDIDATES_PREPARING` → `CANDIDATES_STORED` → `ZIP_BUILDING` → `ZIP_SAVED`.
- O checkpoint é salvo no projeto e também no job persistente do servidor/Redis.
- Assim que todos os IDs possuem candidatas persistidas no Blob/Redis, o app grava `CANDIDATES_STORED` **antes** de montar o ZIP final do Analista.
- Se a montagem do ZIP falhar depois desse ponto, o retry reutiliza os lotes já armazenados e chama apenas `/api/corvo/pacote`; o Collector não é reaberto e as imagens não são recomprimidas.
- Se a página for recarregada em `CANDIDATES_STORED`, `ZIP_BUILDING` ou `ZIP_SAVED`, o Automático Total recupera o checkpoint e continua da etapa correta.
- `ZIP_SAVED` continua usando o comportamento da V0.6.26: falha do Analista gera somente retry do Analista com o mesmo ZIP.
- A interface distingue `CHECKPOINT DO ANALISTA SALVO` de `PACOTE DO ANALISTA SALVO` e oferece retomada manual imediata.
- A nova rota `GET/POST /api/corvo/checkpoint` reconcilia o estado local com candidatos e ZIP existentes no servidor.
- Mantém Corvo Collector V0.8.0; Bridge atualizado para V0.6.15.

## V0.6.26 — pacote do Analista persistente e retry automático

- Depois que o Collector termina a preparação em lotes e o app consolida o ZIP do Analista, esse ZIP passa a ser tratado como artefato persistente do projeto.
- O projeto salva JOB_ID, URL/nome do ZIP, IDs esperados, prompt do Analista, token do job e horários de preparação/último envio.
- Se o Corvo Analista/Bridge estiver indisponível, retornar erro ou devolver manifesto inválido, o app **não volta ao Collector** e não recomprime as imagens.
- O app agenda retry automático com backoff de 1 min → 2 min → 5 min → 10 min e mantém o projeto em `AGUARDANDO ANALISTA`.
- A etapa **PACOTE DO ANALISTA SALVO** aparece na interface e pode ser clicada para `REENVIAR AGORA`.
- Ao recarregar a página durante essa espera, o pacote continua salvo e o timer é retomado.
- Um job do Analista em erro é resetado mantendo o `COLLECTOR_ZIP` anexado; a nova tentativa usa o mesmo pacote físico.
- O Automático Total fica pausado em `ANALISTA`, sem virar falha final, e continua sozinho quando a análise finalmente terminar.
- Mantém Collector V0.8.0; Bridge atualizado para V0.6.15.

## V0.6.25 — Cleaner: clique robusto no item Excluir

- Bridge V0.6.14 espera a conversa e o menu ficarem estáveis, reconhece popovers atuais mesmo sem role=menu e procura especificamente o item Excluir no menu do cabeçalho.
- Espera o menu de conversa e o item Excluir estabilizarem antes do primeiro clique destrutivo.
- Espera o modal/alertdialog de confirmação ficar visível e estável antes de clicar no botão vermelho Excluir.
- Mantém verificação forte após a exclusão; não marca conversa como excluída apenas por ter clicado.

## V0.6.23 — Hotfix de confirmação real do Cleaner

- Bridge V0.6.12 reconhece corretamente o modal de confirmação como `alertdialog`.
- Após clicar em Excluir, aguarda o modal fechar de verdade e espera a mutação ser aplicada antes de navegar.
- A verificação forte reabre a conversa até duas vezes antes de concluir que a exclusão falhou.
- Erros agora incluem o estágio observado, como `DELETE_DID_NOT_HAPPEN:DELETE_APPLY_TIMEOUT`.


## V0.6.22 — Cleaner usa o menu do cabeçalho da conversa

- Bridge V0.6.11 executa a exclusão pelo botão `...` do canto superior direito da conversa atual.
- O menu só é aceito quando contém ações características de chat, como Arquivar/Fixar/Mover e Excluir.
- Depois de clicar em Excluir, o Bridge aguarda o modal e clica no Excluir de confirmação.
- A conversa só recebe `deleted=true` depois da verificação forte de que a mesma URL não carrega mais.


## V0.6.21 — Cleaner confirma exclusão sem depender da URL

- Bridge V0.6.9 corrige `DELETE_NOT_CONFIRMED`: o ChatGPT pode remover a conversa do histórico sem trocar a rota imediatamente.
- A exclusão agora é confirmada por três sinais independentes: mudança da rota, aviso visual de exclusão ou desaparecimento persistente da conversa da barra lateral após fechar o diálogo.
- O Cleaner continua usando uma única aba oculta, com diagnóstico persistente e somente conversas próprias mapeadas.
- Mantém Collector V0.8.0 e todo o pipeline automático da V0.6.20.

Painel de produção do CorvoQuiz com orquestração multiespecialista via **Corvo Bridge**, coleta pelo **Corvo Collector**, seleção visual delegada ao **Corvo Analista**, roteamento por ID, Fallback e ZIP final.


## V0.6.20 — Cleaner rápido e observável

- Bridge V0.6.8 reutiliza uma única aba oculta para excluir as conversas mapeadas.
- Remove o custo de abrir/fechar uma aba por conversa.
- A exclusão procura o menu da conversa na sidebar e no header atual do ChatGPT.
- O popup mostra progresso em tempo real e preserva o último resultado/erro.
- O restante do pipeline permanece igual à V0.6.19.


## V0.6.19 — Cleaner realmente exclui GPTs personalizados

- Bridge V0.6.8 corrige o segundo parser usado durante a exclusão.
- Conversas `/g/<gpt>/c/<id>` não são mais rejeitadas como `CONVERSATION_ID_MISMATCH`.
- Menu, item Excluir e confirmação têm seletores mais tolerantes à UI atual.
- Popup mostra o primeiro código de erro se uma exclusão ainda falhar.
- Collector permanece V0.8.0.


## V0.6.18 — Cleaner do Bridge corrigido para GPTs personalizados

- Bridge V0.6.8 reconhece conversas em `/c/<id>` e também `/g/<gpt>/c/<id>`.
- Reprocessa registros antigos do Cleaner que já possuam `conversationUrl`, preenchendo o `conversationId` ausente.
- Acompanha mudanças de URL da aba durante o job e captura a URL final antes de fechar a conversa.
- Conversas próprias concluídas passam a aparecer em **Pendentes** assim que o ID puder ser resolvido.
- Mantém Collector V0.8.0 e o automático real da Ideia ao ZIP.

## V0.6.17 — busca rápida com teto 20/ID

- Collector V0.8.0 impõe teto real de 20 candidatas únicas por ID.
- GOOGLE: até 20; PINTEREST: até 20; MESCLADO: até 10 + 10.
- A leitura do DOM e a rolagem param assim que a cota do provedor é atingida.
- Configurações antigas acima de 20 são automaticamente normalizadas para 20.
- A shortlist padrão para o Analista continua em até 10 candidatas por ID.


## V0.6.16 — hotfix de retomada do pacote do Collector

- Corrige `PACKAGE_ALREADY_RUNNING` durante o Automático Total.
- Se o mesmo pacote já estiver em andamento, o app e o Collector retomam o acompanhamento em vez de falhar.
- Pacotes órfãos ou sem progresso por 3 minutos são liberados automaticamente pelo Collector.
- Mantém o automático real da Ideia ao ZIP, shortlist 10/ID e batch upload.

## V0.6.15 — Automático real: da ideia ao ZIP final

O **INICIAR AUTOMÁTICO** agora fica no topo, ao lado de **NOVA PRODUÇÃO**, e sempre cria uma produção nova do zero. Ele não é mais um atalho para continuar o projeto atual.

Um único clique executa:

1. valida Redis, Cloudflare R2, Bridge e Collector;
2. cria um projeto automático novo;
3. chama o Corvo Scout sem tema obrigatório;
4. o Scout ordena quatro ideias e coloca em **IDEIA 1** sua recomendação principal;
5. o app escolhe automaticamente a IDEIA 1;
6. envia a ideia completa ao Corvo Roteiro;
7. cria os prompts;
8. inicia o Collector;
9. envia a shortlist técnica de candidatas ao Analista;
10. executa Refinador/Gerador/Fallback sem cliques;
11. executa Thumb e Metadados em paralelo quando habilitados;
12. aguarda todos os arquivos finais;
13. valida a Consolidação;
14. gera e baixa automaticamente o ZIP final.

O botão **NOVA PRODUÇÃO** permanece como modo assistido/manual. O cartão de uma produção automática não possui mais botão para iniciar automático; só mostra **RETOMAR ESTA PRODUÇÃO** se aquela execução tiver sido interrompida ou falhado.

O Roteirista agora recebe também o texto completo da ideia escolhida, preservando CONCEITO e justificativa do Scout em vez de trabalhar apenas com título e tema.

## V0.6.14 — Hotfix de build TypeScript

- Corrige a inferência `string | undefined` do `autoWorkflowJobId`.
- O polling usa `activeJobId:string` antes de `encodeURIComponent`.
- Limita a busca a 20 candidatas únicas por ID (10+10 no modo Mesclado).
- Mantém shortlist 10/ID, batch upload, Collector V0.8.0 e Bridge V0.6.8.

## V0.6.12 — Automático do projeto atual (substituído na V0.6.15)

A primeira implementação encadeava automaticamente etapas de um projeto já existente. Esse comportamento foi substituído na V0.6.15 pelo automático real, iniciado no topo e começando pela descoberta da ideia.

## V0.6.11 — modo automático delegado ao Analista

No modo automático, o app **não escolhe mais uma candidata por ID**. O fluxo agora é:

`COLLECTOR → TODAS AS CANDIDATAS → ZIP BRUTO → ANALISTA → ARQUIVO ESCOLHIDO POR ID → REFINADOR / GERADOR`

O Collector V0.8.0 envia todas as candidatas disponíveis de cada ID ao armazenamento do trabalho do Analista. Cada candidata recebe nome único, por exemplo:

- `video1_001_c001.jpg`
- `video1_001_c002.jpg`
- `video1_002_c001.jpg`

O servidor mantém o mapeamento `ID → candidatas`, monta o ZIP persistente e inclui `CORVO_ANALISE_INPUT.json` + `CORVO_ANALISE_GUIA.txt`.

O Corvo Analista usa agora `CORVO_IMAGE_ANALYSIS VERSION=1.1`. Para cada ID ele compara todas as candidatas e devolve:

- `PASSOU` + `ARQUIVO=<nome exato>` + `REFINAMENTO=LEVE`;
- `PASSOU_COM_RESSALVAS` + `ARQUIVO=<nome exato>` + `REFINAMENTO=FORTE`;
- `NAO_PASSOU` + `ARQUIVO=` + `PROMPT_GERACAO`.

Depois do manifesto, o app consulta o armazenamento original do Collector pelo nome indicado em `ARQUIVO`, associa fisicamente a candidata escolhida ao ID e a envia ao Refinador. O GPT não precisa devolver novamente uma imagem que já existia no Collector.

O modo manual continua disponível: o usuário escolhe uma candidata por ID e o Analista ainda valida/classifica o conjunto.

## Armazenamento de candidatas

Para não transformar o objeto principal do job em uma lista com milhares de URLs, as candidatas do Collector ficam em um registro separado no Upstash Redis, com TTL de 7 dias, enquanto os bytes ficam no Cloudflare R2. O ZIP do Analista é montado a partir desse registro.

Novos/ajustados endpoints:

- `POST /api/corvo/arquivo` — recebe cada candidata com `jobId`, `id`, `nomeArquivo` e arquivo;
- `POST /api/corvo/pacote` — valida cobertura dos IDs e monta o ZIP completo de candidatas;
- `POST /api/corvo/candidato` — resolve os nomes escolhidos pelo Analista para os arquivos físicos originais do Collector.

## Pipeline atual

`IDEIA → ROTEIRO → PROMPTS → COLLECTOR → ANALISTA → REFINADOR / GERADOR → FALLBACK quando necessário → CONSOLIDAÇÃO → ZIP FINAL`

Em paralelo ao Collector:

- **Corvo Thumb** — gera thumbnail; o Bridge captura o arquivo real;
- **Corvo YouTube / Metadados** — opcional; prepara dados editoriais.

### Roteamento

- `PASSOU` → Refinador leve;
- `PASSOU_COM_RESSALVAS` → Refinador forte;
- `NAO_PASSOU` → Gerador;
- Refinador e Gerador podem trabalhar em paralelo;
- Gerador mantém **um único worker por vez**;
- imagem gerada com sucesso já é final e não volta ao Refinador.

### Fallback

Falhas estruturadas de Refinador/Gerador seguem para o Fallback. O app interpreta `RETRY` ou `NAO_RECUPERAVEL`, controla o limite e mantém histórico por ID. São permitidas a tentativa original + até duas novas tentativas.

### Consolidação / ZIP final

A Consolidação só libera o ZIP quando todos os IDs possuem arquivo final real e não há IDs/nomes duplicados ou formatos inválidos. O pacote final inclui imagens, thumbnail quando disponível, metadados, manifesto do Analista e histórico do pipeline.

## Hotfixes preservados

### V0.6.10 / Collector V0.7.6 — diagnóstico de upload

Antes do empacotamento, o app verifica Redis + Cloudflare R2. O Collector preserva o primeiro erro real de upload e interrompe repetição inútil quando detecta erro fatal de armazenamento.

### Bridge V0.6.3/V0.6.7 — captura e anexos grandes

Timeout real, busca mais robusta no DOM, fallback de captura, atualização automática do popup e repetição de captura presa. Na V0.6.5, anexos do Blob são buscados diretamente pela aba do ChatGPT antes do fallback legado, removendo o gargalo interno de 40 MB para o ZIP bruto do Analista.

### Bridge V0.6.4 — Cleaner manual

O popup mostra **Apagar X mapeadas agora**, usando somente conversas próprias, concluídas e já registradas pelo Cleaner. A limpeza automática das 22h continua separada.

## Jobs longos

Jobs persistem por 7 dias. Gerador, Refinador e Fallback não falham apenas por demora local. Ainda falta reidratar automaticamente todos os pollers após uma recarga completa da página; os registros permanecem no servidor.

## Armazenamento e Vercel

Configure no projeto:

1. `CorvoAPI_KEY_IDEIA`;
2. Upstash Redis (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, ou o par `KV_*`);
3. Cloudflare R2;
4. novo deploy após conectar os recursos.

`GET /api/corvo/diagnostico` informa se Redis e Cloudflare R2 estão configurados sem expor segredos.

## Instalação

### Corvo Bridge V0.6.20

Use `public/downloads/CORVO_BRIDGE_V0620_EXTENSION.zip` ou carregue a pasta `corvo-bridge-extension` em `chrome://extensions`.

### Corvo Collector V0.8.0

Use `public/downloads/CORVO_COLLECTOR_V080_EXTENSION.zip` ou carregue a pasta `corvo-collector-extension`. Autorize a origem exata do deploy no popup.

## Downloads dentro do app

- Corvo Collector V0.8.0;
- Corvo Bridge V0.6.20;
- Kit completo CorvoQuiz V0.6.35.

## Fora do escopo atual

Publicação automática no YouTube continua futura: upload do vídeo final, aplicação da thumbnail, metadados, visibilidade e agendamento via YouTube API.

## V0.6.13 — Otimização do automático / transporte em lotes

- O modo automático envia por padrão até 10 candidatas técnicas por ID ao Analista; esse limite é configurável de 1 a 30.
- O app não escolhe a imagem vencedora. O corte é apenas uma shortlist técnica para reduzir transporte; a decisão visual final continua sendo do Corvo Analista.
- Collector V0.8.0 prepara as cópias de análise com 8 workers e envia lotes ZIP de até 36 candidatas.
- Novo endpoint `POST /api/corvo/candidatos-lote` grava um ZIP por lote no Blob e registra todas as entradas em uma única operação no Redis.
- A consolidação do pacote do Analista baixa cada lote uma única vez, mantendo compatibilidade com candidatas antigas armazenadas individualmente.
- Lotes usam retry automático em falhas temporárias de rede, 429 e 5xx.