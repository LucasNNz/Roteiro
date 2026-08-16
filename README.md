# CorvoQuiz Produção — V0.6.9

Painel de produção do CorvoQuiz com orquestração multiespecialista via **Corvo Bridge**, retorno genérico por **GPT Action**, coleta de imagens pelo **Corvo Collector**, roteamento automático por ID, Fallback e ZIP final.

## Pipeline atual

O fluxo implementado nesta versão é:

`IDEIA → ROTEIRO → PROMPTS → COLLECTOR → ANALISTA → REFINADOR / GERADOR → FALLBACK quando necessário → CONSOLIDAÇÃO → ZIP FINAL`

Em paralelo ao início do Collector, o app pode iniciar:

- **Corvo Thumb** — gera a thumbnail e o Bridge captura o arquivo real;
- **Corvo YouTube / Metadados** — opcional nas configurações; prepara o pacote editorial enquanto as imagens são processadas.

A imagem final do Gerador não passa novamente pelo Refinador. O Refinador e o Gerador entregam arquivos finais de seus próprios ramos.

## Fase 3 — Analyst e roteamento real

O Collector V0.7.5 continua criando o pacote original para o Forma, mas também envia ao app uma cópia JPEG leve de cada imagem escolhida. Essas cópias servem apenas ao Analista; o JPEG original do pacote do Collector não é reduzido por essa rotina.

O servidor recebe as imagens individualmente, associa todas ao `JOB_ID` do Analista e cria `POST /api/corvo/pacote`, que monta um ZIP persistente no Vercel Blob. O Bridge V0.6.2 baixa esse ZIP e o anexa à conversa do Corvo Analista.

Depois do manifesto `CORVO_IMAGE_ANALYSIS`, o app valida os IDs e cria uma fila por imagem:

- `PASSOU` → Refinador leve;
- `PASSOU_COM_RESSALVAS` → Refinador forte;
- `NAO_PASSOU` → Gerador.

Para o Refinador, o Bridge anexa a imagem real de origem. Para Refinador e Gerador, um manifesto de sucesso deixa o job em `WAITING_FILE` até o Bridge capturar a imagem final da conversa e enviá-la ao Blob.

O Gerador possui fila global de **um único worker por vez**, inclusive para retries vindos do Fallback.

## Fase 4 — Fallback e tentativas

Falhas estruturadas de Refinador/Gerador são interpretadas por ID usando `FALHOU`, `ERROR_CODE` e `MOTIVO`.

O app envia a falha ao Corvo Fallback, que somente decide:

- `RETRY` + `DESTINO` + `PROMPT_RETRY`; ou
- `NAO_RECUPERAVEL`.

O app — e não o GPT — controla o limite. Esta versão aceita a tentativa original + até duas novas tentativas. Cada ID preserva histórico resumido de execução, erro, Fallback, destino e retry.

Se o Fallback declarar `NAO_RECUPERAVEL`, devolver retry inválido ou o limite for atingido, o ID fica em tratamento manual e a Consolidação não libera o ZIP final.

## Fase 5 — Consolidação / ZIP final

A nova área **Consolidação / ZIP Final** mostra o estado de cada ID e só habilita a geração quando:

- todos os IDs possuem arquivo final real;
- não existem IDs duplicados;
- não existem nomes de arquivo duplicados;
- os nomes finais possuem formato de imagem aceito.

O ZIP final contém:

- `imagens/` — imagens finais ordenadas por ID;
- `thumbnail/` — thumbnail real quando disponível, ou um arquivo de status;
- `youtube/METADADOS.txt` — dados editoriais quando disponíveis, ou status;
- `analise/CORVO_IMAGE_ANALYSIS.txt`;
- `CORVO_FINAL_MANIFEST.json` — associação ID → arquivo, origem, tentativa final e histórico;
- `LEIA-ME.txt`.

## Jobs longos

Os jobs continuam persistidos por 7 dias no Upstash Redis. O app não usa timeout curto para Gerador, Refinador ou Fallback e a Consolidação permanece aguardando até os arquivos finais existirem.

Ainda existe uma melhoria pendente: após uma **recarga completa da página durante um job em andamento**, o registro do job continua no servidor, porém esta versão ainda não religa automaticamente todos os pollers do pipeline. Essa reidratação fica registrada no plano de implementação.

## Thumbnail real

Uma Thumb com `STATUS=GERADA` não é considerada concluída apenas pelo manifesto. O Bridge captura a imagem grande mais recente da conversa, envia os bytes para `/api/corvo/arquivo`, e o job só muda para `DONE` quando manifesto + arquivo estão presentes.

A validação final dessa captura precisa ser feita no deploy de produção com **Vercel Blob conectado** e a URL real do GPT Thumb configurada no Bridge.

## Armazenamento e Vercel

Configure no projeto:

1. `CorvoAPI_KEY_IDEIA`;
2. Upstash Redis (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, ou o par `KV_*`);
3. Vercel Blob (`BLOB_READ_WRITE_TOKEN`, ou credenciais disponibilizadas pela integração do Blob);
4. novo deploy após conectar os recursos.

`GET /api/corvo/diagnostico` informa se Redis e Blob estão configurados sem expor segredos.

## Endpoints principais

- `POST /api/corvo/job` — cria jobs dos especialistas;
- `POST /api/corvo/resultado` — recebe manifesto/texto da Action;
- `GET /api/corvo/resultado?jobId=...` — acompanha estado, manifesto e arquivos;
- `POST /api/corvo/arquivo` — recebe thumbnails, imagens do Collector e imagens finais capturadas;
- `POST /api/corvo/pacote` — monta o ZIP de entrada persistente do Analista.

## Especialistas do Bridge

O Corvo Bridge possui URLs independentes para:

- Ideias / Scout;
- Roteiro;
- Prompts;
- Analista;
- Refinador;
- Gerador;
- Fallback;
- Thumb;
- YouTube / Metadados.

As URLs ficam nas opções da extensão e não são hardcoded na lógica do app.

## Instalação

### Corvo Bridge V0.6.2

1. Extraia `corvo-bridge-extension` ou use `public/downloads/CORVO_BRIDGE_V062_EXTENSION.zip`.
2. Abra `chrome://extensions`, ative **Modo do desenvolvedor** e carregue a pasta sem compactação.
3. Cadastre as URLs dos GPTs nas opções.
4. Mantenha a origem do app configurada para o deploy do CorvoQuiz.

### Corvo Collector V0.7.5

1. Extraia `corvo-collector-extension` ou use `public/downloads/CORVO_COLLECTOR_V075_EXTENSION.zip`.
2. Carregue a extensão sem compactação.
3. No popup, autorize a origem exata do site.

## Downloads dentro do app

O menu de configurações aponta para:

- Corvo Collector V0.7.5;
- Corvo Bridge V0.6.2;
- Kit completo CorvoQuiz V0.6.9.

## Fora do escopo atual

A publicação automática no YouTube ainda não faz parte deste pacote. A evolução futura poderá receber o vídeo final do Forma e executar upload de vídeo, thumbnail, metadados, visibilidade e agendamento via YouTube API.
