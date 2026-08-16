# Plano de implementação — Novo fluxo CorvoQuiz

Bases: `CORVOQUIZ_ESPECIFICACAO_NOVO_FLUXO_APP_BRIDGE` e `CORVOQUIZ_MUDANCA_MODO_AUTOMATICO_ANALISTA`.

## Fase 1 — Fundação

- [x] Especialistas configuráveis: Analista, Refinador, Gerador, Fallback, Thumb e YouTube.
- [x] Jobs persistentes por 7 dias.
- [x] Manifestos estruturados e regra de arquivo real para Thumb/Refinador/Gerador.

## Fase 2 — Arquivos e ramos paralelos

- [x] Vercel Blob + `POST /api/corvo/arquivo`.
- [x] Thumb paralela e captura pelo Bridge.
- [x] YouTube/Metadados opcional em paralelo.
- [ ] Validar a captura da Thumb no deploy real com Blob conectado.

## Fase 3 — Collector → Analista → roteamento

- [x] Job do Analista criado antes do transporte das imagens.
- [x] ZIP persistente anexado ao Corvo Analista.
- [x] Validação de IDs do manifesto.
- [x] `PASSOU` → Refinador leve.
- [x] `PASSOU_COM_RESSALVAS` → Refinador forte.
- [x] `NAO_PASSOU` → Gerador.
- [x] Arquivo real de origem anexado ao Refinador.
- [x] Arquivos finais de Refinador/Gerador capturados e persistidos.
- [x] Gerador com um worker global.

## Alteração V0.6.11 — automático delegado ao Analista

- [x] Remover seleção visual automática do app.
- [x] No modo `AUTO`, incluir todas as candidatas retornadas pelo Collector.
- [x] Nomear candidatas de forma única por `ID + índice`.
- [x] Transportar `id` junto de cada `COLLECTOR_IMAGE`.
- [x] Separar o registro das candidatas do objeto principal do job para suportar lotes grandes.
- [x] Montar ZIP completo com índice `ID → candidatas`.
- [x] Atualizar Analista para `CORVO_IMAGE_ANALYSIS VERSION=1.1`.
- [x] Exigir `ARQUIVO=<nome exato>` em PASSOU/PASSOU_COM_RESSALVAS.
- [x] Resolver fisicamente os nomes escolhidos pelo Analista no armazenamento original do Collector.
- [x] Manter modo manual disponível.
- [x] Manter Refinador e Gerador em ramos paralelos após a análise.

## Fase 4 — Fallback

- [x] Detectar `FALHOU`, `ERROR_CODE`, `MOTIVO`.
- [x] `RETRY` / `NAO_RECUPERAVEL`.
- [x] Até duas novas tentativas.
- [x] Histórico por ID e tratamento manual quando necessário.

## Fase 5 — Consolidação

- [x] Validar todos os IDs finais.
- [x] Detectar ausentes/duplicados/formato inválido.
- [x] ZIP final com imagens, thumb, metadados, análise e histórico.
- [x] Aguardar os dois ramos antes de concluir.
- [ ] Reidratar automaticamente pollers de jobs após F5/reabertura do app.

## Fora do escopo

- Upload/publicação automática no YouTube.
- Métricas pós-publicação.
