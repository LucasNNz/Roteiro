# CorvoQuiz Produção — V0.2

Painel visual de pré-produção do CorvoQuiz com o **Corvo Collector V0.7.4** integrado à etapa de imagens.

## Fluxo implementado

1. Ideia
2. Roteiro
3. Prompts
4. Busca de imagens em segundo plano
5. Seleção automática ou revisão rápida
6. Reprocura apenas da cena atual, descartando URLs anteriores
7. Organização e pacote identificado para o Forma

As opções técnicas ficam escondidas no botão de três pontos. O usuário escolhe apenas entre **Automático** e **Revisão rápida**.

## Instalar

### Site

Envie o conteúdo deste ZIP a um repositório do GitHub e importe o projeto no Vercel.

### Extensão

1. Extraia a pasta `corvo-collector-extension`.
2. Abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e escolha a pasta.
5. Abra o popup da extensão e adicione a origem exata do site Vercel em **Origens autorizadas**.

O ID fixo esperado é `eaekknadnghlpncgbhnmldofajelmlbo`.

## Observação

O pacote de imagens é mantido pelo coletor e identificado por código. Ele não é baixado automaticamente pelo painel. Uma cópia pode ser salva em **Opções do pacote**.
