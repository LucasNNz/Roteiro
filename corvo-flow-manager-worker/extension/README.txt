CORVO FLOW WORKER V3.2.0 — FAILURE ISOLATION

Base direta: V3.1.3 Manifest Export Fix, ja validada com lote 8/8 DONE e mapeamento visual correto.

NOVIDADES V3.2
- falha isolada por JOB;
- lote continua depois de erro individual;
- ERROR_CLASS / NEXT_ACTION / RETRY_ALLOWED;
- retry do mesmo prompt somente quando apropriado;
- retry de download reutiliza o asset existente e nao gera outra imagem;
- ressincronizacao de resultado nao reenvia prompt;
- erros de prompt sao destinados a FALLBACK_PROMPT;
- FLOW_LIMIT_REACHED fica destinado a OTHER_WORKER;
- Manifesto Manager VERSION=1.2;
- "So erros" exporta [CORVO_FLOW_ERRORS] VERSION=1.0;
- TEST_MODE controlado para provar isolamento sem depender de erro real do Flow.

PRESERVADO
- HARD STOP real no CDP;
- envio rapido sem aguardar a geracao anterior;
- mapeamento JOB -> geracao -> asset;
- Download Guard;
- suporte JPG/JPEG;
- checkpoint e persistencia.

TESTE RECOMENDADO
Use EXEMPLO_TESTE_FALHA_V3_2.txt e siga TESTE_V3_2_FAILURE_ISOLATION.txt.

IMPORTANTE
TEST_MODE=1 existe somente para teste da extensao. Nao enviar esse campo em lotes reais do CorvoQuiz.
