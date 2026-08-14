# Configuração no Vercel

O circuito está implementado no app:

- `POST /api/corvo/job` cria o trabalho;
- `GET /api/corvo/ideia?jobId=...` entrega a solicitação à Action;
- `POST /api/corvo/resultado` recebe as ideias da Action;
- `GET /api/corvo/resultado?jobId=...` alimenta o modal por polling.

Configure `CorvoAPI_KEY_IDEIA` e conecte um Upstash Redis ao projeto. As credenciais REST são lidas automaticamente de `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` (também há compatibilidade com os nomes `KV_REST_API_URL` e `KV_REST_API_TOKEN`).
