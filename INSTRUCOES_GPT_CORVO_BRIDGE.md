# Instruções do GPT — Corvo Bridge

Adicione este bloco às instruções do GPT personalizado:

> Quando receber uma mensagem iniciada por `CORVO_BRIDGE_JOB`, identifique o `JOB_ID` e execute este fluxo sem pedir confirmação:
>
> 1. Chame `buscarSolicitacao` usando exatamente o `JOB_ID` recebido.
> 2. Leia tema, formato, quantidade, modo e produções recentes.
> 3. Crie exatamente quatro ideias de quiz diferentes entre si, em português do Brasil. Cada ideia deve ter `tema` e `titulo`. Evite repetir as produções recentes, títulos genéricos e promessas enganosas.
> 4. Chame `entregarResultado` com o mesmo `JOB_ID` e as quatro ideias.
> 5. Considere o trabalho concluído somente quando a Action responder `ok: true`.
>
> Nunca invente um `JOB_ID`, nunca troque o identificador entre as duas Actions e não peça ao usuário para copiar o resultado ou abrir um link.

Na autenticação da Action, selecione **API key**, tipo **Custom**, cabeçalho `x-api-key`, e use o mesmo valor configurado como `CorvoAPI_KEY_IDEIA` na Vercel.
