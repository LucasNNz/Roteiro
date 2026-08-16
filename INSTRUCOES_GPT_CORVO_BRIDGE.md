# V0.6.49 / BRIDGE V0.6.33 — CAPTURA RECUPERÁVEL POR JOB

O Bridge não deve depender do texto visual do popup para reconstruir uma captura. Cada JOB persiste `capturePlan` e, em retry, o Bridge consulta o status do CorvoQuiz para descobrir `expectedFiles`, arquivos já recebidos e o próximo arquivo pendente. Uma aba do ChatGPT fechada/recarregada não pode apagar o JOB.

# V0.6.48 / BRIDGE V0.6.32 — RETRY MANUAL

O app agora permite reabrir falhas terminais manualmente sem refazer Collector/Analista. Bridge permanece V0.6.32.

# V0.6.47 / BRIDGE V0.6.32 — PRESET OU

O contrato do Forma usa `TIPO: QUAL_VOCE_PREFERE` com `IMAGEM_A` e `IMAGEM_B`. No CorvoQuiz, cada uma vira um slot físico independente (`01_A`, `01_B`). O Bridge pode capturar esses slots como imagens separadas ou recortar uma grade técnica 2-colunas, mas o pacote final nunca deve fundir A e B em um único arquivo.

# Instruções do GPT — Corvo Bridge

Adicione este bloco às instruções dos três GPTs personalizados: ideias, roteiro e prompts de imagem.

> Quando receber uma mensagem iniciada por `CORVO_BRIDGE_JOB`, considere que a solicitação completa já está presente na própria mensagem. Não tente buscar a solicitação externamente. Execute normalmente a pesquisa e o trabalho solicitado. Ao concluir, use obrigatoriamente a Action disponível de retorno ao CorvoQuiz. Envie exatamente o `JOB_ID` recebido e todo o resultado final no campo `resultado`. Não exija que o usuário copie, selecione ou confirme a resposta. Após a Action confirmar sucesso, pode mostrar a resposta normalmente na conversa.

Na autenticação da Action, selecione **API key**, tipo **Custom**, cabeçalho `x-api-key`, e use o mesmo valor configurado como `CorvoAPI_KEY_IDEIA` na Vercel.

Use o mesmo schema `CORVOQUIZ_OPENAPI_GPT_ACTION.yaml` em todos eles. A única operação necessária é `entregarResultadoCorvo` em `POST /api/corvo/resultado`; o `JOB_ID` identifica automaticamente o trabalho e o especialista correto.


## ENVIO AO ANALISTA — RETOMADA V0.6.32

Para jobs com anexo, o Bridge deve tratar cada microetapa como progresso e nunca reiniciar um prompt que já contenha o mesmo JOB_ID no composer. Se o anexo já estiver visível, deve reutilizá-lo. Só considerar o envio concluído quando a mensagem do usuário estiver commitada na conversa; enquanto houver progresso, renovar o timeout ocioso. Erros de leitura do Blob preservam o pacote e devem retornar código estruturado ao app para retry sem Collector.
