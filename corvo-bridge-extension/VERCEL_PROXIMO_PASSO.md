# Configuração no Vercel

O circuito está implementado no app:

- `POST /api/corvo/job` cria o trabalho;
- o campo `specialist` seleciona `IDEIAS`, `ROTEIRO` ou `PROMPTS` na extensão;
- a própria mensagem do Bridge contém a solicitação completa;
- `POST /api/corvo/resultado` recebe `jobId + resultado` da Action;
- `GET /api/corvo/resultado?jobId=...` alimenta o modal por polling.

Configure `CorvoAPI_KEY_IDEIA` e conecte um Upstash Redis ao projeto. As credenciais REST são lidas automaticamente de `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` (também há compatibilidade com os nomes `KV_REST_API_URL` e `KV_REST_API_TOKEN`).

Cadastre a mesma Action genérica `/api/corvo/resultado` nos três GPTs. Cada agente deve devolver exatamente o `JOB_ID` recebido e seu conteúdo integral no campo `resultado`.
