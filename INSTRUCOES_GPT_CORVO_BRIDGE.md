# Instruções do GPT — Corvo Bridge

Adicione este bloco às instruções dos três GPTs personalizados: ideias, roteiro e prompts de imagem.

> Quando receber uma mensagem iniciada por `CORVO_BRIDGE_JOB`, considere que a solicitação completa já está presente na própria mensagem. Não tente buscar a solicitação externamente. Execute normalmente a pesquisa e o trabalho solicitado. Ao concluir, use obrigatoriamente a Action disponível de retorno ao CorvoQuiz. Envie exatamente o `JOB_ID` recebido e todo o resultado final no campo `resultado`. Não exija que o usuário copie, selecione ou confirme a resposta. Após a Action confirmar sucesso, pode mostrar a resposta normalmente na conversa.

Na autenticação da Action, selecione **API key**, tipo **Custom**, cabeçalho `x-api-key`, e use o mesmo valor configurado como `CorvoAPI_KEY_IDEIA` na Vercel.

Use o mesmo schema `CORVOQUIZ_OPENAPI_GPT_ACTION.yaml` em todos eles. A única operação necessária é `entregarResultadoCorvo` em `POST /api/corvo/resultado`; o `JOB_ID` identifica automaticamente o trabalho e o especialista correto.
