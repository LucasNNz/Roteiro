# CORVO BRIDGE V0.4.0

Fluxo desta versão:

CORVOQUIZ → EXTENSÃO → GPT DE IDEIAS / ROTEIRO / PROMPTS (ABA INATIVA)

O retorno esperado é:

GPT PERSONALIZADO → ACTION → VERCEL → CORVOQUIZ

## Instalação

1. Descompacte o ZIP.
2. Abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta descompactada `corvo-bridge-extension`.
6. Abra as opções da extensão.
7. Cole as URLs exatas do GPT de ideias, do GPT de roteiro e do GPT de prompts de imagem.
8. Salve.

## O que faz

- recebe `jobId + prompt + specialist + meta` do CorvoQuiz;
- escolhe automaticamente o GPT correspondente a `IDEIAS`, `ROTEIRO` ou `PROMPTS`;
- abre ou reutiliza uma aba inativa do GPT configurado, sem tirar o usuário do CorvoQuiz;
- espera o campo de prompt ficar disponível;
- preenche o composer disparando `beforeinput` e `input`;
- aguarda um botão de envio realmente habilitado e tenta múltiplos seletores;
- usa o submit do formulário ou Enter como fallback;
- só confirma sucesso quando o composer esvazia ou a mensagem aparece na conversa;
- retorna `GPT_SEND_FAILED` quando o texto foi preenchido, mas o envio não foi confirmado;
- se o editor não sincronizar em segundo plano, ativa a aba apenas durante a repetição e devolve o foco ao CorvoQuiz;
- antes de repetir, verifica o `JOB_ID` na conversa para evitar mensagem duplicada;
- inclui o JOB_ID no comando;
- deixa o retorno para a Action do GPT.

## Integração mínima do app

Inclua/adapte `corvo-bridge-client.js` e chame:

```js
CorvoBridge.dispatch({
  jobId: `corvo_${Date.now()}`,
  specialist: "ROTEIRO",
  prompt: "Crie o roteiro completo para a ideia aprovada.",
  meta: { formato: "LONGO", quantidade: 10 }
});
```

## Instrução obrigatória no GPT

Quando receber uma solicitação iniciada por `CORVO_BRIDGE_JOB`, considere que toda a solicitação já está na mensagem. Execute o trabalho e chame `entregarResultadoCorvo` com o mesmo `JOB_ID` e o conteúdo integral no campo `resultado`.

Use o mesmo arquivo `CORVOQUIZ_OPENAPI_GPT_ACTION.yaml` nos três GPTs. Ele habilita somente a entrega genérica em `/api/corvo/resultado`, portanto o mesmo contrato recebe ideias, roteiros e prompts.

## Segurança

Não coloque `CORVO_API_KEY` nesta extensão. A chave continua exclusivamente no GPT Action/Vercel.
