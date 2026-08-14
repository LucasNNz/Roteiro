# CORVO BRIDGE V0.2

Fluxo desta versão:

CORVOQUIZ → EXTENSÃO → GPT PERSONALIZADO (ABA INATIVA)

O retorno esperado é:

GPT PERSONALIZADO → ACTION → VERCEL → CORVOQUIZ

## Instalação

1. Descompacte o ZIP.
2. Abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta `CORVO_BRIDGE_V01`.
6. Abra as opções da extensão.
7. Cole a URL exata do GPT CORVO SCOUT.
8. Salve.

## O que faz

- recebe `jobId + prompt + specialist + meta` do CorvoQuiz;
- abre ou reutiliza uma aba inativa do GPT configurado, sem tirar o usuário do CorvoQuiz;
- espera o campo de prompt ficar disponível;
- envia automaticamente a solicitação;
- inclui o JOB_ID no comando;
- deixa o retorno para a Action do GPT.

## Integração mínima do app

Inclua/adapte `corvo-bridge-client.js` e chame:

```js
CorvoBridge.dispatch({
  jobId: `corvo_${Date.now()}`,
  specialist: "SCOUT",
  prompt: "Procure ideias virais de quiz sobre animais.",
  meta: { formato: "LONGO", quantidade: 10 }
});
```

## Instrução obrigatória no GPT

Quando receber uma solicitação iniciada por `CORVO_BRIDGE_JOB`, extraia o `JOB_ID`, chame `buscarSolicitacao`, produza exatamente quatro ideias e chame `entregarResultado` com o mesmo `JOB_ID`. Não dependa de copiar ou selecionar a mensagem na interface.

Use o arquivo `CORVOQUIZ_OPENAPI_GPT_ACTION.yaml` que acompanha o app. Ele habilita a leitura em `/api/corvo/ideia` e a entrega em `/api/corvo/resultado`.

## Segurança

Não coloque `CORVO_API_KEY` nesta extensão. A chave continua exclusivamente no GPT Action/Vercel.
