# Integração com CorvoQuiz Produção — Collector V0.8.0

O app usa o protocolo `corvo-collector/1` e os comandos existentes do Collector.

## V0.7.9 — package resume idempotente

Quando `BUILD_FORMA_PACKAGE` recebe novamente a mesma produção/arquivo/seleções enquanto o pacote ainda está ativo, retorna `ok=true` e `resumed=true` em vez de `PACKAGE_ALREADY_RUNNING`. Pacotes órfãos ou sem progresso são liberados automaticamente.

## V0.7.8 — shortlist técnica + batch upload

No modo `AUTO`, o app continua sem escolher uma candidata vencedora por ID. Antes do transporte, ele limita tecnicamente o conjunto para até 10 candidatas por ID por padrão (configurável de 1 a 30), usando o ranking técnico já calculado por resolução/fonte/relevância textual. A decisão visual final continua sendo do Corvo Analista.

Nomes no automático seguem o padrão:

- `video1_001_c001.jpg`
- `video1_001_c002.jpg`
- `video1_002_c001.jpg`

## Transporte em lotes

Em vez de um `POST /api/corvo/arquivo` por candidata, o modo automático:

1. prepara as cópias JPEG de análise com até 8 workers;
2. agrupa até 36 candidatas por ZIP;
3. envia o lote para `POST /api/corvo/candidatos-lote`;
4. o servidor grava um Blob por lote e registra todas as entradas daquele lote no Redis em uma operação;
5. `POST /api/corvo/pacote` baixa cada lote uma única vez e consolida o ZIP final entregue ao Analista.

Cada ZIP fica, no pior caso normal de 36 × 60 KB, perto de 2,1 MB antes do overhead, abaixo do teto adotado no endpoint de lote.

Os lotes usam até 3 tentativas em erros temporários de rede, HTTP 408/425/429 e 5xx.

`BUILD_FORMA_PACKAGE` continua aceitando:

- `pipelineOnly=true`: não mantém um segundo ZIP completo local; usa o transporte em lotes;
- `packageMode=ANALYST_RAW`: identifica a entrada de análise;
- `pipelineUpload`: `jobId`, `uploadToken` e `appOrigin`.

No modo `MANUAL`, permanece o fluxo anterior de uma candidata escolhida por ID. O endpoint individual `/api/corvo/arquivo` continua disponível para compatibilidade.

## Diagnóstico de armazenamento

O app consulta `/api/corvo/diagnostico` antes do empacotamento. Redis e Vercel Blob precisam estar disponíveis. O Collector preserva `pipelineErrors[]` para mostrar a causa real quando um lote falhar.


## V0.8.0 — limite de coleta

O service worker limita cada ID a no máximo 20 candidatas únicas. Em `MIXED`, divide a meta em 10 Pinterest + 10 Google e encerra a rolagem de cada provedor assim que atinge a respectiva cota.
