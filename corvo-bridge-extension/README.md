# CORVO BRIDGE V0.6.30 — AUTO-FECHAMENTO CONFIRMADO + CAPTURA MV3

- **Atualizar lista** reconcilia as conversas mapeadas com o ChatGPT e remove da fila registros de conversas apagadas manualmente.
- Antes de cada exclusão, o Cleaner faz uma pré-checagem: se a conversa já não existir, marca `REMOVED_EXTERNALLY` e segue sem repetir a tentativa.
- **Parar limpeza** cancela a fila atual, fecha a aba oculta de manutenção e impede que o Cleaner avance para a próxima conversa.
- O popup e as Configurações exibem o estado de atualização/parada.

## V0.6.30 — fechamento confirmado + canal de captura curto

- Quando o upload do último arquivo retorna `DONE`, o próprio background fecha a aba `bridgeOwned`; Thumb/Gerador/Refinador não dependem mais do comando final do app.
- O vínculo do job só é apagado depois do fechamento confirmado; há até 3 tentativas e estado `closePending` se necessário.
- `CORVO_CAPTURE_AND_UPLOAD` responde imediatamente com `accepted=true`; o resultado final é entregue via `CORVO_BRIDGE_STATUS`.
- A captura do ChatGPT é feita em fatias curtas, evitando manter o canal MV3 aberto por ~30 segundos.
- Se uma navegação/reload destruir o content script, o Bridge revalida a versão e tenta novamente na mesma conversa.
- Detecta quando um lote com vários `ARQUIVO=` foi entregue como uma única imagem composta e retorna `BATCH_COMPOSITE_IMAGE_DETECTED` em vez de anexar o mosaico ao primeiro ID.
- Cleaner, STOP persistente, checkpoint e captura de variantes continuam preservados.

# HISTÓRICO — V0.6.24 — BATCHING + CLEANER RESILIENTE

- Suporta jobs com até 10 anexos/imagens no mesmo lote.
- `forceNewConversation=true` cria exatamente uma conversa nova por lote; retries técnicos do mesmo job usam a mesma aba/conversa quando possível.
- Retry semântico do mesmo especialista recebe `preferredConversationUrl` e continua a conversa original do lote.
- Detecta modal de excesso de solicitações e retorna `CHATGPT_RATE_LIMITED` para o app pausar o lote em vez de disparar Fallback.
- Captura em lote mantém associação `arquivo esperado -> imagem física`, evitando reutilizar a mesma imagem para vários IDs. Imagens anexadas pelo usuário são excluídas dos candidatos de captura; somente respostas do assistant podem virar saída física.
- Cleaner continua após qualquer falha individual, deduplica conversationId e preserva falhas para nova tentativa. Uma falha reseta a aba de manutenção antes de seguir para o próximo histórico.

# CORVO BRIDGE V0.6.23 — SEGUNDO PLANO TOTAL + CENTRAL AO VIVO

- Expõe ao CorvoQuiz os jobs/conversas ainda ativos.
- Permite focar a aba exata de um job pelo painel do app.
- Mantém a trava contra reenvio duplicado do Analista.

# CORVO BRIDGE V0.6.23 — CHECKPOINT DO ENVIO AO ANALISTA

## V0.6.23 — retries sem roubar foco + segundo plano total

- Reutiliza rascunho do mesmo JOB_ID em vez de preencher novamente o composer.
- Se o ZIP já estiver anexado, retoma diretamente do envio.
- Timeouts são renovados enquanto houver progresso real no composer/anexo/envio.
- A mensagem só é considerada enviada quando o JOB_ID aparece como mensagem do usuário ou há confirmação equivalente de commit da conversa.
- Erros do proxy de Blob agora preservam o código real (`BLOB_CONTENT_READ_FORBIDDEN`, etc.) em vez de terminar sempre como `ATTACHMENT_FETCH_403`.
- O background usa o proxy autenticado do CorvoQuiz antes do fetch bruto e mantém diagnóstico por microetapa.

## V0.6.18 — hotfix ATTACHMENT_FETCH_403

- Mantém a autorrecuperação do content script da V0.6.17.
- Quando o Blob não pode ser lido diretamente da página do ChatGPT, tenta `/api/corvo/download` no app usando o token do próprio job.
- O proxy recupera o arquivo no servidor e evita o gap de CORS/403 entre ChatGPT/extensão e Vercel Blob.
- Diagnóstico novo: `ATTACHMENT_PROXY_FETCH_START`, `ATTACHMENT_PROXY_FETCH_OK` e `ATTACHMENT_PROXY_FETCH_FAIL`.

# CORVO BRIDGE V0.6.17 — AUTORRECUPERAÇÃO DO CONTENT SCRIPT + DIAGNÓSTICO

## V0.6.17 — hotfix do handshake em aba reutilizada

- Se uma aba do ChatGPT for reutilizada sem o `chatgpt-bridge.js` ativo, o Bridge detecta `Receiving end does not exist`.
- Tenta injetar `chatgpt-bridge.js` programaticamente via `chrome.scripting.executeScript`.
- Se a injeção não confirmar, recarrega a aba do GPT e aguarda o content script declarativo subir.
- O envio só avança depois de `PING_OK`.
- Novos eventos de diagnóstico: `CONTENT_SCRIPT_MISSING`, `CONTENT_SCRIPT_INJECT_START/OK/FAILED`, `TAB_RELOAD_FOR_CONTENT_SCRIPT`, `TAB_RELOAD_COMPLETE/FAILED`.
- Mantém todo o diagnóstico V0.6.16.


O Bridge registra os estados reais do envio ao GPT e permite copiar o diagnóstico pelo popup. O log inclui composer, file inputs, download/anexo, botão de enviar e confirmação da mensagem, sem copiar o conteúdo integral do prompt ou tokens sensíveis.

Em uma falha, abra o popup e use **Copiar diagnóstico do último job**.


## V0.6.15 — correção do gap Analista

- O Bridge diferencia abrir o GPT de efetivamente enviar a solicitação.
- Preenche a mensagem primeiro, para o estado ficar visível e verificável.
- Seleciona o input de arquivo ligado ao composer por pontuação/contexto, evitando inputs globais errados.
- O ZIP só é considerado anexado quando o nome real aparece no editor.
- Timeout de anexo não é mais ignorado.
- Se o envio em segundo plano falhar por estado da UI, o Bridge ativa temporariamente a aba e tenta novamente.
- Mensagem só é considerada enviada quando o JOB_ID aparece numa mensagem do usuário na conversa.
- Jobs com anexos podem permanecer em envio por até 12 minutos sem o app declarar ausência do Bridge.
- Estados intermediários são enviados ao app: WAITING_COMPOSER, FILLING_COMPOSER, FETCHING_ATTACHMENT, ATTACHING_FILE, ATTACHMENT_READY, READY_TO_SEND, SENDING_MESSAGE e MESSAGE_CONFIRMED.
- Mantém o Cleaner corrigido da V0.6.14.


A exclusão não avança mais por delays curtos. O Bridge espera a conversa ficar carregada e estável, o menu do cabeçalho abrir e estabilizar, o item Excluir aparecer, o modal de confirmação ficar visível/estável e o botão vermelho ficar habilitado antes de confirmar. Isso evita cliques antes da hidratação/animação da interface.

## Cleaner V0.6.12

Hotfix baseado na interface atual observada do ChatGPT.

Fluxo de exclusão:
1. abre a conversa mapeada;
2. identifica o botão de três pontos no canto superior direito do cabeçalho;
3. valida o menu pelo conjunto de ações de conversa (Arquivar/Fixar/Mover + Excluir);
4. clica em Excluir;
5. aguarda o modal de confirmação;
6. clica no botão Excluir do modal;
7. sai da conversa, reabre a URL e só marca deleted=true se a conversa realmente não carregar mais.

Não usa menus de mensagens e não depende do menu de linha da sidebar para executar a exclusão.
- Só abre o menu da linha exata da conversa mapeada.
- Após confirmar a exclusão, sai da conversa e reabre a mesma URL.
- Só marca `deleted=true` se a conversa realmente não carregar mais.
- Se ainda carregar, retorna `DELETE_DID_NOT_HAPPEN`; se não houver evidência suficiente, `DELETE_VERIFICATION_UNKNOWN`.

## Cleaner V0.6.9 — confirmação de exclusão corrigida

A confirmação não depende mais somente de a URL sair de `/c/<id>`. O Cleaner aceita mudança de rota, aviso de exclusão ou remoção persistente da conversa da barra lateral depois que o diálogo de confirmação fecha. Isso corrige `DELETE_NOT_CONFIRMED` quando o ChatGPT remove o chat do histórico mas mantém temporariamente a rota aberta.


## Cleaner V0.6.8 — exclusão em GPT personalizado

- O apagador agora reconhece `/c/<id>` em qualquer ponto da URL, incluindo `/g/<gpt>/c/<id>`.
- Links da barra lateral de GPTs personalizados também são reconhecidos.
- Seletores de menu/exclusão/confirmação foram ampliados.
- O popup mostra o primeiro código real de falha quando alguma exclusão não é confirmada.


## Hotfix V0.6.3 mantido

- captura de imagem não fica mais aguardando indefinidamente: cada tentativa tem timeout real;
- busca da imagem ficou compatível com os novos contêineres/turnos da interface do ChatGPT;
- fallback de leitura: fetch da página, canvas e download pelo background com permissão para `*.oaiusercontent.com`;
- popup atualiza automaticamente a cada segundo;
- estados `CAPTURING_FILE`, `UPLOADING_FILE` e `FILE_DELIVERED` aparecem com nomes amigáveis;
- botão **Tentar captura novamente** permite recuperar um job já parado em `CAPTURING_FILE`, inclusive a thumb atual, sem recriar o JOB_ID.


## Especialistas configuráveis

O Bridge possui endereços independentes para Ideias/Scout, Roteiro, Prompts, Analista, Refinador, Gerador, Fallback, Thumb e YouTube/Metadados.

## O que mudou nesta versão

Além de preencher e enviar prompts, o Bridge agora transporta arquivos nos dois sentidos:

- baixa do Vercel Blob o ZIP do Collector e o anexa ao Corvo Analista;
- baixa a imagem de origem aprovada e a anexa ao Corvo Refinador;
- captura da conversa a thumbnail gerada;
- captura da conversa a imagem final do Refinador;
- captura da conversa a imagem final do Gerador;
- envia as imagens capturadas ao `/api/corvo/arquivo` usando o token exclusivo do job.

O token de upload fica no estado privado da extensão e não é incluído no prompt enviado ao GPT.

## Regra de conclusão de arquivos

Para Thumb, Refinador e Gerador, o manifesto textual não garante que o arquivo exista. Quando o app informa `WAITING_FILE`, ele pede ao Bridge a captura da imagem real. Só depois do upload o servidor marca o job como concluído.

## Instalação

1. Descompacte o ZIP.
2. Abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação**.
5. Selecione `corvo-bridge-extension`.
6. Abra as opções e cadastre as URLs dos GPTs usados.
7. Salve.

## Cleaner

O Cleaner continua protegido pelas mesmas regras da V0.6.1: começa desativado, possui Modo Teste, só considera conversas executadas em abas pertencentes ao Bridge e só remove jobs confirmados como concluídos.

### Mantido da V0.6.4 — limpeza manual

O popup possui o botão **Apagar mapeadas agora**. Ele usa exatamente as conversas já registradas pelo Cleaner como `eligible=true`, concluídas, ainda não excluídas e com `conversationId` conhecido. A ação manual pede confirmação e executa a exclusão real imediatamente, independentemente do horário agendado e sem alterar a configuração de Modo Teste da limpeza automática.

### Novo na V0.6.6 — ZIP bruto do Analista

O Bridge tenta buscar anexos públicos do Vercel Blob diretamente na aba do ChatGPT e os injeta como `File` no seletor de upload. Isso evita transformar ZIPs grandes em Base64 dentro da mensageria da extensão. O método antigo pelo background continua como fallback para anexos menores.

O tempo de espera do botão de envio também passa a considerar o tamanho do anexo, evitando disparar o prompt antes de um ZIP grande ficar disponível no composer.

## Segurança

Não coloque `CORVO_API_KEY` na extensão. A chave da Action permanece no GPT/Vercel. Os tokens temporários de arquivo são gerados por job e usados apenas na comunicação Bridge → app.


## Cleaner V0.6.6 — correção de GPT personalizado

O Bridge agora reconhece IDs tanto em `/c/<id>` quanto em `/g/<gpt>/c/<id>`, repara registros antigos salvos com URL mas sem `conversationId`, acompanha mudanças de URL enquanto o job roda e captura a URL final antes de fechar a aba. Conversas concluídas pelo Bridge passam a aparecer imediatamente em **Pendentes** quando forem elegíveis para exclusão.


## Cleaner V0.6.8 — execução rápida e diagnóstico persistente

- reutiliza uma única aba oculta para toda a limpeza;
- navega pelas conversas sequencialmente, sem abrir uma aba nova por item;
- usa timeouts menores e seleção mais tolerante do menu da conversa;
- mostra progresso `Limpando X/Y`;
- mantém o último resultado e o primeiro código de erro no popup;
- marca `deleted=true` somente após a conversa sair da rota atual.

## V0.6.27 — STOP persistente

O comando **Parar limpeza** agora é persistido no `chrome.storage.local`, fecha a aba de manutenção mesmo após reinício do service worker e recupera automaticamente estados `running=true` órfãos. O Cleaner consulta o cancelamento entre navegações, retries e esperas, impedindo que a fila avance depois do STOP.


## V0.6.28 — galerias e múltiplas variantes

- reconhece o novo gallery/card de imagens mesmo quando ele fica fora de `data-message-author-role="assistant"`;
- lê todos os `ARQUIVO=` do manifesto para saber quantas saídas físicas são esperadas;
- quando o ChatGPT devolve 2 variantes por ID, agrupa as imagens por linha/posição visual e escolhe uma representante por arquivo;
- Thumb com duas opções escolhe a variante principal/maior (ou a primeira equivalente) em vez de travar;
- elimina miniaturas duplicadas pelo mesmo `src` e registra diagnóstico `CAPTURE_IMAGE_SLOT_SELECTED`.
