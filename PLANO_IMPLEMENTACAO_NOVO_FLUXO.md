## Alteração V0.6.35 — migração de checkpoint legado + probe real do R2

- Checkpoints antigos do Vercel Blob são detectados e não entram em retry infinito.
- O app reinicia somente a embalagem de imagens no novo storage R2.
- Se o Collector ainda possui o job `DONE`, ele reutiliza os resultados sem nova pesquisa.
- O diagnóstico testa assinatura/credenciais/bucket R2 com uma leitura autenticada antes do Collector.

## Alteração V0.6.35 — R2 alinhado às variáveis reais da Cloudflare

O armazenamento físico do pipeline migra para Cloudflare R2. Redis continua responsável por estados/jobs/checkpoints; Vercel continua hospedando o app e as Functions.

Regras:
- nenhum upload novo usa `@vercel/blob`;
- lotes, ZIP do Analista, imagens finais e thumb são gravados em R2 sob `corvoquiz/<JOB_ID>/...`;
- o bucket pode ser privado e URLs GET são assinadas temporariamente;
- `/api/corvo/download` valida JOB_ID + token e faz proxy do objeto R2 quando a leitura direta do browser falhar;
- checkpoints `CANDIDATES_STORED` e `ZIP_SAVED` continuam válidos na nova store;
- lifecycle recomendado: apagar prefixo `corvoquiz/` após 7 dias.

## Alteração V0.6.32 — checkpoint fino do envio ao Analista

O despacho do Analista deixa de usar um timeout único e passa a persistir microestados: editor pronto, rascunho preenchido, anexo recuperado, anexo confirmado, controle de envio pronto, envio disparado, mensagem commitada e resposta iniciada.

Regras:
- retry do mesmo JOB_ID reutiliza o rascunho já presente no composer;
- ZIP já visível no composer não é baixado/anexado novamente;
- qualquer progresso real renova o timeout ocioso;
- existe um limite absoluto de segurança para impedir espera infinita;
- falha do Blob mantém código estruturado e o checkpoint do pacote;
- somente ausência real de progresso leva o job ao timer de retry.

## Alteração V0.6.31 — proxy autenticado do ZIP do Analista

O diagnóstico V1 chegou até `COMPOSER_FILL_OK` e falhou exatamente em `ATTACHMENT_FETCH_DIRECT_FAIL` / `ATTACHMENT_FETCH_403`. O transporte do ZIP deixa de depender da leitura direta do domínio Blob dentro do ChatGPT. O app fornece `appOrigin` + token do job ao Bridge; quando a leitura direta falha, o Bridge chama `GET /api/corvo/download`, que autentica o job, valida que a origem é um Blob interno `corvoquiz/` e usa `@vercel/blob.get()` no servidor para devolver o stream. O mesmo pacote `ZIP_SAVED` é reutilizado; nenhuma etapa do Collector/preparo é refeita.

## Alteração V0.6.30 — autorrecuperação do handshake em aba reutilizada

O diagnóstico mostrou `TAB_REUSED` seguido de `Receiving end does not exist`: a aba do Analista estava aberta, mas sem o content script do Bridge. O Bridge V0.6.17 passa a detectar esse estado, injetar `chatgpt-bridge.js` via `chrome.scripting`, e usar reload da aba como fallback. Nenhum anexo/prompt é iniciado antes do `PING_OK`. O checkpoint de preparação continua preservado durante toda a recuperação.

## Alteração V0.6.29 — diagnóstico de handshake do Analista

O Bridge V0.6.16 passa a persistir um trace por JOB_ID cobrindo: abertura/ping da aba, composer, preenchimento, download do anexo, descoberta e estado dos inputs de arquivo, confirmação visual do ZIP, botões de envio e presença do JOB_ID na mensagem do usuário. O trace pode ser copiado pelo popup para localizar a falha exata sem desmontar o checkpoint do Analista.

# Plano de implementação — Novo fluxo CorvoQuiz

Bases: `CORVOQUIZ_ESPECIFICACAO_NOVO_FLUXO_APP_BRIDGE` e `CORVOQUIZ_MUDANCA_MODO_AUTOMATICO_ANALISTA`.

## Fase 1 — Fundação

- [x] Especialistas configuráveis: Analista, Refinador, Gerador, Fallback, Thumb e YouTube.
- [x] Jobs persistentes por 7 dias.
- [x] Manifestos estruturados e regra de arquivo real para Thumb/Refinador/Gerador.

## Fase 2 — Arquivos e ramos paralelos

- [x] Cloudflare R2 + `POST /api/corvo/arquivo` (V0.6.35; usa R2_BUCKET_NAME + R2_ENDPOINT).
- [x] Thumb paralela e captura pelo Bridge.
- [x] YouTube/Metadados opcional em paralelo.
- [ ] Validar a captura da Thumb no deploy real com Blob conectado.

## Fase 3 — Collector → Analista → roteamento

## Alteração V0.6.28 — handshake real de envio ao Analista

- O Bridge não pode considerar que abrir a aba do GPT equivale a enviar o job.
- Um job com anexo passa pelos estados WAITING_COMPOSER → FILLING_COMPOSER → FETCHING_ATTACHMENT → ATTACHING_FILE → ATTACHMENT_READY → READY_TO_SEND → SENDING_MESSAGE → MESSAGE_CONFIRMED.
- ATTACHMENT_READY exige o nome real do arquivo presente no editor.
- MESSAGE_CONFIRMED exige o JOB_ID presente numa mensagem real do usuário na conversa.
- Falha/timeout de anexo é recuperável usando o checkpoint do pacote; não remonta Collector/ZIP.
- Se a UI não funcionar em segundo plano, o Bridge pode ativar temporariamente a aba para um retry focado e voltar à aba de origem depois.
- O timeout de transporte com anexo é ampliado para 12 minutos.

## Alteração V0.6.27 — checkpoint fino da preparação do Analista

- [x] Persistir estágio `JOB_CREATED` ao criar o job do Analista.
- [x] Persistir `CANDIDATES_PREPARING` durante preparo/upload dos lotes.
- [x] Validar no servidor que todos os IDs possuem ao menos uma candidata antes do checkpoint reutilizável.
- [x] Persistir `CANDIDATES_STORED` antes da montagem do ZIP.
- [x] Persistir `ZIP_BUILDING` e `ZIP_SAVED`.
- [x] Criar `GET/POST /api/corvo/checkpoint` para reconciliação após F5/reabertura.
- [x] Falha em `CANDIDATES_STORED`/`ZIP_BUILDING` retoma somente `/api/corvo/pacote`, reutilizando os lotes no R2/Redis.
- [x] Falha após `ZIP_SAVED` continua retentando somente o Analista.
- [x] Retry automático usa backoff 1 min → 2 min → 5 min → 10 min também para a montagem do pacote.
- [x] UI expõe `CHECKPOINT DO ANALISTA SALVO` e permite retomada manual sem Collector.

## Alteração V0.6.26 — checkpoint persistente antes do Analista

- [x] Após a consolidação, o ZIP do Analista fica salvo no Cloudflare R2 e referenciado no projeto.
- [x] Persistir `analysisJobId`, URL/nome do ZIP, IDs esperados, prompt, token e timestamps da tentativa.
- [x] Falha de Bridge/Analista não volta ao Collector nem refaz compressão/lotes.
- [x] Retry automático com backoff 1 min → 2 min → 5 min → 10 min.
- [x] Botão `PACOTE DO ANALISTA SALVO` permite reenvio manual imediato.
- [x] F5/reabertura preserva o checkpoint e retoma o timer do Analista.
- [x] Job do Analista pode ser resetado para retry sem remover o `COLLECTOR_ZIP` já anexado.
- [x] Automático Total permanece `RUNNING`/`ANALISTA` durante a espera e continua sozinho quando a análise terminar.

- [x] Job do Analista criado antes do transporte das imagens.
- [x] ZIP persistente anexado ao Corvo Analista.
- [x] Validação de IDs do manifesto.
- [x] `PASSOU` → Refinador leve.
- [x] `PASSOU_COM_RESSALVAS` → Refinador forte.
- [x] `NAO_PASSOU` → Gerador.
- [x] Arquivo real de origem anexado ao Refinador.
- [x] Arquivos finais de Refinador/Gerador capturados e persistidos.
- [x] Gerador com um worker global.


## Alteração V0.6.16 — retomada idempotente do pacote do Collector

- Corrige o erro recorrente `PACKAGE_ALREADY_RUNNING` após a coleta.
- O mesmo pacote da mesma produção pode ser solicitado novamente sem duplicar trabalho: o Collector retorna `resumed=true` e o app continua o polling.
- Se o estado `RUNNING/QUEUED` ficou órfão porque o offscreen worker desapareceu, o lock é liberado automaticamente.
- Se não houver progresso por 3 minutos, o pacote é considerado stale e pode ser reconstruído.
- O app também reconhece pacote legado ativo pelo mesmo `fileName + total` e retoma o acompanhamento.

## Alteração V0.6.15 — Automático Total real

- [x] Botão `INICIAR AUTOMÁTICO` movido para o topo, ao lado de `NOVA PRODUÇÃO`.
- [x] Clique no automático cria uma produção nova com `stage=IDEIA`.
- [x] Scout executa descoberta automática sem exigir escolha humana.
- [x] Scout é instruído a colocar sua recomendação principal como IDEIA 1.
- [x] App seleciona automaticamente a IDEIA 1 e preserva seu texto completo.
- [x] Roteirista recebe a ideia completa, não só título/tema.
- [x] Roteiro → Prompts → Collector → Analista → Refinador/Gerador → Fallback → Merge sem cliques intermediários.
- [x] Thumb e Metadados continuam paralelos.
- [x] ZIP final é gerado/baixado automaticamente.
- [x] Modo assistido continua em `NOVA PRODUÇÃO`.
- [x] Projeto interrompido oferece `RETOMAR ESTA PRODUÇÃO` apenas no próprio cartão.

## Alteração V0.6.11 — automático delegado ao Analista

- [x] Remover seleção visual automática do app.
- [x] No modo `AUTO`, incluir todas as candidatas retornadas pelo Collector.
- [x] Nomear candidatas de forma única por `ID + índice`.
- [x] Transportar `id` junto de cada `COLLECTOR_IMAGE`.
- [x] Separar o registro das candidatas do objeto principal do job para suportar lotes grandes.
- [x] Montar ZIP completo com índice `ID → candidatas`.
- [x] Atualizar Analista para `CORVO_IMAGE_ANALYSIS VERSION=1.1`.
- [x] Exigir `ARQUIVO=<nome exato>` em PASSOU/PASSOU_COM_RESSALVAS.
- [x] Resolver fisicamente os nomes escolhidos pelo Analista no armazenamento original do Collector.
- [x] Manter modo manual disponível.
- [x] Manter Refinador e Gerador em ramos paralelos após a análise.

## Fase 4 — Fallback

- [x] Detectar `FALHOU`, `ERROR_CODE`, `MOTIVO`.
- [x] `RETRY` / `NAO_RECUPERAVEL`.
- [x] Até duas novas tentativas.
- [x] Histórico por ID e tratamento manual quando necessário.

## Fase 5 — Consolidação

- [x] Validar todos os IDs finais.
- [x] Detectar ausentes/duplicados/formato inválido.
- [x] ZIP final com imagens, thumb, metadados, análise e histórico.
- [x] Aguardar os dois ramos antes de concluir.
- [ ] Reidratar automaticamente pollers de jobs após F5/reabertura do app.

## Fora do escopo

- Upload/publicação automática no YouTube.
- Métricas pós-publicação.

## OTIMIZAÇÃO V0.6.13 — SHORTLIST + BATCH UPLOAD

- [x] Limitar o automático a até 10 candidatas por ID por padrão, configurável de 1 a 30.
- [x] Preservar o Analista como único decisor visual da imagem vencedora.
- [x] Agrupar cópias de análise em ZIPs de até 36 candidatas.
- [x] Preparar lotes com 8 workers.
- [x] Enviar cada lote com retry automático.
- [x] Registrar dezenas de candidatas no Redis com um único HSET por lote.
- [x] Montar o ZIP final do Analista baixando cada lote apenas uma vez.
- [x] Preservar compatibilidade com candidatas individuais das versões anteriores.

## HOTFIX V0.6.14 — BUILD TYPESCRIPT

- `runAutomaticSpecialist` valida `jobId` após criação/recuperação.
- O loop de polling usa `activeJobId:string`, eliminando o erro de build em `encodeURIComponent(jobId)`.
- Sem alteração funcional no pipeline ou nas extensões.



## OTIMIZAÇÃO V0.6.17 / COLLECTOR V0.8.0
- Busca limitada a 20 candidatas únicas por ID.
- GOOGLE/PINTEREST: teto 20. MIXED: 10 + 10.
- A rolagem para assim que a cota é atingida.
- Shortlist para Analista continua padrão 10/ID.
