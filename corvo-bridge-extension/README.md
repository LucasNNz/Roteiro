# CORVO BRIDGE V0.6.2 — ARQUIVOS DO PIPELINE + THUMB

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

## Segurança

Não coloque `CORVO_API_KEY` na extensão. A chave da Action permanece no GPT/Vercel. Os tokens temporários de arquivo são gerados por job e usados apenas na comunicação Bridge → app.
