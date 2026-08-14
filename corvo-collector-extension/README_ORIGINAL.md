# Corvo Collector Bridge V0.4

Mantém o modo manual da V0.3.1 e adiciona uma interface externa para o Corvo Produção.

## ID fixo desta extensão
`eaekknadnghlpncgbhnmldofajelmlbo`

O `manifest.json` inclui uma `key`, então este ID deve permanecer o mesmo ao recarregar versões derivadas desta base em modo de desenvolvimento.

## Bridge externo
Comandos implementados:
- `PING`
- `START_JOB`
- `GET_STATUS`
- `GET_RESULT`
- `CANCEL_JOB`

Protocolo: `corvo-collector/1`.

## Segurança
O manifesto aceita páginas `*.vercel.app` e localhost para o MVP, mas o service worker só executa comandos após a origem exata ser adicionada no campo **Origens autorizadas** do popup.

## Primeiro teste
1. Instale a pasta `extension` em `chrome://extensions`.
2. Confirme que o ID exibido é `eaekknadnghlpncgbhnmldofajelmlbo`.
3. Hospede `vercel-bridge-demo` no Vercel ou rode num servidor local em localhost.
4. Copie a origem exibida pela página (ex.: `https://meu-app.vercel.app`) para **Origens autorizadas** na extensão.
5. Na página, clique em **Conectar**.
6. Envie apenas um termo no primeiro teste.
7. Clique em **Iniciar coleta**.

A extensão abre o Pinterest, coleta os candidatos e o site recebe status e metadados de volta.


## V0.4.1 — execução em segundo plano

- Jobs remotos abrem a busca com `active: false`.
- O Chrome não troca o foco da aba atual do usuário.
- A aba de trabalho continua existindo na barra de abas enquanto o job roda, mas fica em segundo plano.
- Ao finalizar, cancelar ou falhar, a aba de trabalho é fechada automaticamente por padrão.
- O payload remoto aceita:
  - `backgroundTab: true|false`
  - `closeTabOnFinish: true|false`

Os dois padrões são `true`.


## V0.5.0 — fila multi-termos

- progresso por item (`itemSummaries`);
- resumo do job (`summary.completed`, `summary.candidates`);
- resultados continuam agrupados por termo em `results`.


## V0.7.0 — pacote final para Forma

Comandos externos novos:
- `BUILD_FORMA_PACKAGE`
- `GET_PACKAGE_STATUS`

A extensão usa um documento offscreen para:
- baixar a melhor URL disponível de cada principal;
- converter a imagem para JPEG;
- gerar ZIP;
- iniciar o download do pacote final.


## V0.7.3.1 — hotfix multi-fonte

Corrige `provider is not defined` durante a varredura Google Imagens/Pinterest.
O seletor Vercel V0.7.3 continua compatível; basta atualizar a extensão.
