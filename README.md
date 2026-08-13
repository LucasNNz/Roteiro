# CorvoQuiz Produção — V0.1

MVP do painel de pré-produção do CorvoQuiz. O fluxo organiza tema, formato, etapa, arquivos e ZIP de cada produção em uma interface responsiva.

## Rodar localmente

```bash
npm install
npm run dev
```

## Publicar no Vercel

1. Envie esta pasta para um repositório no GitHub.
2. No Vercel, escolha **Add New > Project** e importe o repositório.
3. Mantenha as configurações detectadas e publique.

O arquivo `vercel.json` já direciona o build para Next.js.

## O que funciona nesta versão

- modal central para iniciar uma produção;
- seleção de Reels/Vídeo completo, unidade/lote e modo rápido/pesquisa;
- projetos guardados no navegador;
- avanço visual entre cinco etapas;
- recebimento inicial de ZIP/JPG/PNG;
- download de um ZIP organizado por projeto;
- atalho para abrir o Corvo no ChatGPT.

Antes de publicar, substitua o endereço `https://chatgpt.com/` em `app/page.tsx` pelo link direto do GPT CorvoQuiz.
