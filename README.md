# CORVOQUIZ ROTEIRO V0.8.0 — FLOW → FORMA → VÍDEO FINAL

## V0.8.0

O Forma foi incorporado ao próprio Roteiro como motor final da esteira automática. Depois que o Corvo Flow Manager conclui e devolve todas as imagens, o app valida os nomes físicos contra o `ROTEIRO.TXT`, entrega roteiro + assets ao módulo Lote do Forma e aciona o exportador original de projeto inteiro em MP4.

Fluxo automático: **IDEIA → ROTEIRO → PROMPTS → FLOW → FORMA → MP4 FINAL**. Não há download intermediário. O navegador inicia o download somente quando o vídeo final está pronto.

O transporte principal é direto em memória. Se essa entrada for recusada, o app tenta automaticamente um **ZIP em memória** pelo contrato TXT + ZIP original do Forma. O botão **ZIP DE BACKUP / FORMA MANUAL** permanece disponível como terceira rota.

O Forma original foi preservado: painel Lote manual, parser, presets, cenas, transições, áudio e exportação continuam funcionando. Ele também está disponível integralmente na rota `/forma` dentro da mesma aplicação.

## V0.7.3

`PROMPTS.TXT` aceita nativamente **1 parágrafo = 1 asset físico**, separado por uma linha em branco. O app usa o `ROTEIRO.TXT` como fonte de verdade para descobrir ID, slot e nome do arquivo e normaliza tudo para o lote do Flow Manager. O formato legado `ID|...` continua compatível.
