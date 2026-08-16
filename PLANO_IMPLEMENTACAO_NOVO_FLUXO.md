# Plano de implementação — Novo fluxo CorvoQuiz

Base: especificação `CORVOQUIZ_ESPECIFICACAO_NOVO_FLUXO_APP_BRIDGE`, versão 1.0.

## Fase 1 — Fundação de orquestração (V0.6.6)

- [x] Registrar Analista, Refinador, Gerador, Fallback, Thumb e YouTube como especialistas válidos.
- [x] Adicionar URLs configuráveis para todos os especialistas no Corvo Bridge.
- [x] Criar prompts/contratos base para os novos jobs.
- [x] Aumentar a retenção dos jobs de 1 hora para 7 dias.
- [x] Adicionar estados de longa duração e campos de resultado/arquivo.
- [x] Interpretar manifestos de análise, refinamento, geração, fallback e thumbnail.
- [x] Impedir que `THUMB STATUS=GERADA` conclua o job sem o arquivo real.
- [x] Preservar o fluxo existente de Ideias, Roteiro, Prompts e Collector.

## Fase 2 — Arquivos reais e ramos paralelos

- [x] Implementar armazenamento persistente de arquivos do pipeline com Vercel Blob.
- [x] Criar `POST /api/corvo/arquivo` com validação de job, token, tipo, nome e tamanho.
- [x] Fazer o Bridge identificar e capturar a imagem gerada pelo Corvo Thumb.
- [x] Associar o arquivo ao `JOB_ID` e concluir a Thumb somente com manifesto + arquivo.
- [x] Iniciar Thumb em paralelo quando o Collector começar.
- [x] Preparar o disparo paralelo opcional do Corvo YouTube/Metadados.
- [ ] Validar em produção real a captura da Thumb com o Blob conectado e o GPT Thumb configurado.

## Fase 3 — Roteamento automático de imagens (V0.6.8)

- [x] Criar um job do Analista antes da montagem do pacote.
- [x] Enviar ao app cópias leves das imagens escolhidas pelo Collector.
- [x] Montar no servidor um ZIP persistente de análise sem enviar um ZIP grande pela Function de entrada.
- [x] Fazer o Bridge anexar o ZIP real ao Corvo Analista.
- [x] Interpretar todos os IDs do manifesto e rejeitar IDs ausentes, duplicados ou inesperados.
- [x] Separar `PASSOU` para Refinador leve.
- [x] Separar `PASSOU_COM_RESSALVAS` para Refinador forte.
- [x] Separar `NAO_PASSOU` para Gerador.
- [x] Fazer o Bridge anexar a imagem de origem real ao Refinador.
- [x] Capturar e armazenar as imagens finais do Refinador e do Gerador.
- [x] Manter o Gerador em uma fila global de um único worker.

## Fase 4 — Fallback e recuperação (V0.6.9)

- [x] Detectar `FALHOU`, `ERROR_CODE` e `MOTIVO` por ID.
- [x] Encaminhar falhas de Gerador/Refinador ao Corvo Fallback.
- [x] Interpretar `RETRY` e `NAO_RECUPERAVEL`.
- [x] Executar o retry no destino indicado pelo Fallback.
- [x] Limitar a duas novas tentativas (`3` execuções no máximo contando a original).
- [x] Manter histórico de tentativa, especialista, erro, decisão e prompt de retry por ID.
- [x] Exibir tentativa atual, erro e histórico resumido na Consolidação.
- [x] Marcar `NAO_RECUPERAVEL` / limite atingido como tratamento manual.

## Fase 5 — Consolidação e ZIP final (V0.6.9)

- [x] Criar área **Consolidação / ZIP Final**.
- [x] Reunir as imagens finais reais do Refinador e Gerador.
- [x] Bloquear conclusão quando existir ID sem arquivo final.
- [x] Detectar IDs duplicados, nomes duplicados e extensões inválidas.
- [x] Ordenar por ID e renomear pelo nome final contratado.
- [x] Gerar `CORVO_FINAL_MANIFEST.json` com origem e histórico de cada ID.
- [x] Incluir thumbnail real quando disponível.
- [x] Incluir metadados do Corvo YouTube quando disponíveis.
- [x] Incluir manifesto do Analista.
- [x] Gerar o ZIP final para o Forma somente quando a validação estiver verde.
- [x] Manter a Consolidação em estado de espera enquanto os jobs ainda não terminaram.
- [ ] Automatizar a retomada dos *pollers* de Gerador/Refinador/Fallback após uma recarga completa do navegador. Os jobs continuam persistidos por 7 dias no servidor, mas a retomada automática do acompanhamento ainda precisa de uma rotina de reidratação.

## Fora do escopo desta versão

- Upload automático do vídeo final para o YouTube.
- Aplicação automática da thumbnail no vídeo publicado.
- Agendamento/publicação via YouTube API.
- Métricas pós-publicação.

## Regra central

O app é o orquestrador. Os GPTs executam especialidades; o Bridge transporta jobs, anexa arquivos de entrada e captura arquivos gerados; o app controla estados, filas, tentativas, arquivos, Fallback e Consolidação.
