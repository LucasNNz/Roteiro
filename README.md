# CorvoQuiz Produção — V0.6.14

Painel de produção do CorvoQuiz com orquestração multiespecialista via **Corvo Bridge**, coleta pelo **Corvo Collector**, seleção visual delegada ao **Corvo Analista**, roteamento por ID, Fallback e ZIP final.

## V0.6.14 — Hotfix de build TypeScript

- Corrige a inferência `string | undefined` do `autoWorkflowJobId` no Modo Automático Total.
- O polling agora usa um `activeJobId` validado como `string` antes de chamar `encodeURIComponent`.
- Mantém integralmente a shortlist de 10 candidatas/ID, batch upload, Collector V0.7.8 e Bridge V0.6.5.


## V0.6.13 — Automático Total: um clique até o ZIP

A tela de produção ganhou um botão separado **INICIAR AUTOMÁTICO**. Ele não substitui o modo manual/assistido: é uma segunda forma de operar o mesmo projeto.

Ao clicar, o app:

1. valida Redis, Vercel Blob e conexão do Collector;
2. cria o roteiro se ainda não existir;
3. cria os prompts se ainda não existirem;
4. inicia o Collector;
5. força a seleção visual para `AUTO`, enviando todas as candidatas ao Analista;
6. aguarda o manifesto do Analista;
7. executa Refinador e Gerador automaticamente, com Fallback/retries;
8. inicia Thumbnail e, quando ativado, YouTube/Metadados em paralelo;
9. aguarda os arquivos reais de todos os ramos;
10. valida a Consolidação;
11. gera e baixa automaticamente `${PROJECT_ID}_CORVO_FINAL.zip`.

Etapas que já estiverem prontas são reaproveitadas. O automático só interrompe quando existe uma exceção real, como armazenamento indisponível, falha final não recuperável, thumbnail obrigatória ausente ou inconsistência no merge. A UI mostra um painel com o progresso das etapas e permite interromper manualmente. Se a página for recarregada durante a execução, o projeto fica marcado para **RETOMAR AUTOMÁTICO** em vez de permanecer falsamente travado como RUNNING.

## V0.6.11 — modo automático delegado ao Analista

No modo automático, o app **não escolhe mais uma candidata por ID**. O fluxo agora é:

`COLLECTOR → TODAS AS CANDIDATAS → ZIP BRUTO → ANALISTA → ARQUIVO ESCOLHIDO POR ID → REFINADOR / GERADOR`

O Collector V0.7.8 envia todas as candidatas disponíveis de cada ID ao armazenamento do trabalho do Analista. Cada candidata recebe nome único, por exemplo:

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

Para não transformar o objeto principal do job em uma lista com milhares de URLs, as candidatas do Collector ficam em um registro separado no Upstash Redis, com TTL de 7 dias, enquanto os bytes ficam no Vercel Blob. O ZIP do Analista é montado a partir desse registro.

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

Antes do empacotamento, o app verifica Redis + Vercel Blob. O Collector preserva o primeiro erro real de upload e interrompe repetição inútil quando detecta erro fatal de armazenamento.

### Bridge V0.6.3/V0.6.5 — captura e anexos grandes

Timeout real, busca mais robusta no DOM, fallback de captura, atualização automática do popup e repetição de captura presa. Na V0.6.5, anexos do Blob são buscados diretamente pela aba do ChatGPT antes do fallback legado, removendo o gargalo interno de 40 MB para o ZIP bruto do Analista.

### Bridge V0.6.4 — Cleaner manual

O popup mostra **Apagar X mapeadas agora**, usando somente conversas próprias, concluídas e já registradas pelo Cleaner. A limpeza automática das 22h continua separada.

## Jobs longos

Jobs persistem por 7 dias. Gerador, Refinador e Fallback não falham apenas por demora local. Ainda falta reidratar automaticamente todos os pollers após uma recarga completa da página; os registros permanecem no servidor.

## Armazenamento e Vercel

Configure no projeto:

1. `CorvoAPI_KEY_IDEIA`;
2. Upstash Redis (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, ou o par `KV_*`);
3. Vercel Blob;
4. novo deploy após conectar os recursos.

`GET /api/corvo/diagnostico` informa se Redis e Blob estão configurados sem expor segredos.

## Instalação

### Corvo Bridge V0.6.5

Use `public/downloads/CORVO_BRIDGE_V065_EXTENSION.zip` ou carregue a pasta `corvo-bridge-extension` em `chrome://extensions`.

### Corvo Collector V0.7.8

Use `public/downloads/CORVO_COLLECTOR_V077_EXTENSION.zip` ou carregue a pasta `corvo-collector-extension`. Autorize a origem exata do deploy no popup.

## Downloads dentro do app

- Corvo Collector V0.7.8;
- Corvo Bridge V0.6.5;
- Kit completo CorvoQuiz V0.6.13.

## Fora do escopo atual

Publicação automática no YouTube continua futura: upload do vídeo final, aplicação da thumbnail, metadados, visibilidade e agendamento via YouTube API.

## V0.6.13 — Otimização do automático / transporte em lotes

- O modo automático envia por padrão até 10 candidatas técnicas por ID ao Analista; esse limite é configurável de 1 a 30.
- O app não escolhe a imagem vencedora. O corte é apenas uma shortlist técnica para reduzir transporte; a decisão visual final continua sendo do Corvo Analista.
- Collector V0.7.8 prepara as cópias de análise com 8 workers e envia lotes ZIP de até 36 candidatas.
- Novo endpoint `POST /api/corvo/candidatos-lote` grava um ZIP por lote no Blob e registra todas as entradas em uma única operação no Redis.
- A consolidação do pacote do Analista baixa cada lote uma única vez, mantendo compatibilidade com candidatas antigas armazenadas individualmente.
- Lotes usam retry automático em falhas temporárias de rede, 429 e 5xx.
