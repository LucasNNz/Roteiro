# CORVO BRIDGE V0.6.15 — ENVIO CONFIRMADO PARA GPTS COM ANEXO

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