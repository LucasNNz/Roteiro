# Integração com CorvoQuiz Produção — Collector V0.7.7

O app usa o protocolo `corvo-collector/1` e os comandos existentes do Collector.

## V0.7.7 — automático delegado ao Corvo Analista

No modo `AUTO`, o app não escolhe uma candidata por ID. Ele transforma cada candidata retornada pelo Collector em uma entrada física independente e envia todas ao armazenamento do trabalho do Analista.

Nomes no automático seguem o padrão:

- `video1_001_c001.jpg`
- `video1_001_c002.jpg`
- `video1_002_c001.jpg`

Cada upload `COLLECTOR_IMAGE` envia também o campo `id`, permitindo manter a associação física `ID → candidatas` sem gravar milhares de URLs dentro do objeto principal do job.

`BUILD_FORMA_PACKAGE` aceita agora:

- `pipelineOnly=true`: não mantém um segundo ZIP local em memória; envia as candidatas ao app para o ZIP persistente do Analista;
- `packageMode=ANALYST_RAW`: identifica o pacote bruto de análise;
- `pipelineUpload`: `jobId`, `uploadToken` e `appOrigin`.

As cópias destinadas ao Analista continuam sendo JPEGs reduzidos para transporte, mas nenhuma candidata é descartada ou escolhida pelo app. O conjunto é completo em relação às candidatas retornadas pelo Collector.

No modo `MANUAL`, permanece o fluxo em que o usuário escolhe uma candidata por ID antes do envio.

## Diagnóstico de armazenamento

O app consulta `/api/corvo/diagnostico` antes do empacotamento. Redis e Vercel Blob precisam estar disponíveis. O Collector preserva `pipelineErrors[]` para mostrar a causa real quando um upload falhar.
