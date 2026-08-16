# Integração com CorvoQuiz Produção — Collector V0.7.5

O app usa o protocolo `corvo-collector/1` e os comandos:

- `PING`
- `START_JOB`
- `GET_STATUS`
- `GET_RESULT`
- `SEARCH_MORE_GROUP`
- `BUILD_FORMA_PACKAGE`
- `GET_PACKAGE_STATUS`
- `SAVE_PACKAGE_AS`

## Entrega paralela para o Analista

`BUILD_FORMA_PACKAGE` pode receber `pipelineUpload` com `jobId`, `uploadToken` e `appOrigin`.

Quando presente, o offscreen:

1. busca a imagem selecionada;
2. mantém o JPEG normal no ZIP original do Collector/Forma;
3. cria uma cópia reduzida exclusiva para análise;
4. envia essa cópia como `COLLECTOR_IMAGE` para `/api/corvo/arquivo`;
5. informa `pipelineUploaded` e `pipelineUploadFailed` no status do pacote.

A cópia de análise é limitada agressivamente para que lotes grandes possam ser reunidos em um ZIP anexável ao GPT Analista. Isso não altera a qualidade do arquivo mantido no ZIP original do Collector.

Para aceitar o site, adicione a origem Vercel no popup da extensão. O manifesto aceita domínios `*.vercel.app`.
