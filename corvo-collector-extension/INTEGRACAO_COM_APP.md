# Integração com CorvoQuiz Produção V0.2

O app usa o protocolo `corvo-collector/1` e os comandos:

- `PING`
- `START_JOB`
- `GET_STATUS`
- `GET_RESULT`
- `SEARCH_MORE_GROUP`
- `BUILD_FORMA_PACKAGE`
- `GET_PACKAGE_STATUS`
- `SAVE_PACKAGE_AS`

Na configuração padrão, a busca ocorre em aba de fundo, a aba fecha ao terminar e o pacote não é baixado automaticamente.

Para aceitar o site, adicione a origem Vercel no popup da extensão. O manifesto já aceita domínios `*.vercel.app`.
