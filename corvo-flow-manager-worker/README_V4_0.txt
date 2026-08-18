CORVO FLOW MANAGER / WORKER V4.0.2

IMPORTANTE: esta versao corrige perfis OFFLINE no Chrome atual usando Chrome for Testing para carregar automaticamente a extensao Worker. Veja HOTFIX_V4_0_2.txt.

DATA=2026-08-17

OBJETIVO DESTA VERSAO
=====================
A V4.0 transforma o Worker V3.2 em uma arquitetura Manager + Workers capaz de cadastrar dinamicamente varios perfis persistentes de navegador.

NAO EXISTE LIMITE FIXO DE 2 PERFIS.
Os IDs sao criados dinamicamente:
FLOW_PROFILE_01
FLOW_PROFILE_02
FLOW_PROFILE_03
FLOW_PROFILE_04
...

Os dois primeiros perfis continuam sendo apenas o teste minimo recomendado.

ARQUITETURA
===========
1. START_MANAGER.bat inicia o Manager local em http://127.0.0.1:32145.
2. O dashboard permite ADICIONAR PERFIL.
3. Cada perfil recebe um diretorio Chrome separado e persistente.
4. O Manager abre o Chrome usando esse diretorio e carrega a extensao Worker V4.0.
5. O usuario faz login Google/Flow manualmente na primeira vez daquele perfil.
6. Cookies/sessao ficam no diretorio persistente do perfil; o Manager nao guarda senha Google.
7. Cada Worker faz heartbeat no Manager.
8. O Manager mantem uma fila central e distribui JOBs para Workers AVAILABLE.
9. Ao detectar FLOW_LIMIT_REACHED, o perfil vira LIMIT_REACHED e JOBs ainda nao enviados voltam para a fila.
10. Outro perfil AVAILABLE pode receber os mesmos JOB_ID/SLOT/ARQUIVO_FINAL sem alterar o prompt.

PERSISTENCIA DOS PERFIS
=======================
No Windows, os dados ficam fora da pasta da versao:
%LOCALAPPDATA%\CorvoFlowManager\

Isso evita perder login/perfis quando a extensao for atualizada para uma nova pasta/ZIP.

COMO INICIAR
============
1. Extraia o ZIP inteiro para uma pasta normal.
2. Deixe a V3.x antiga desativada durante o teste V4.
3. Execute START_MANAGER.bat. Ele verifica e prepara automaticamente Node.js 18+ e Google Chrome quando necessario.
4. No dashboard, clique + Adicionar perfil.
5. O Chrome deve abrir em uma instancia separada daquele perfil.
6. Na primeira configuracao, faca login Google manualmente e abra/autorize o Flow.
7. Repita para quantos perfis quiser cadastrar.
8. Perfis autenticados devem aparecer AVAILABLE quando o Worker estiver conectado.

FILA CENTRAL
============
O dashboard aceita TXT estruturado [FLOW_BATCH].
O Manager distribui por JOB e nao fixa uma producao inteira em uma conta.

BURST POR WORKER
================
Configura quantos JOBs o Manager entrega em uma rodada para um Worker.
Padrao: 5.
Faixa nesta versao: 1 a 20 JOBs por assignment.
Isso NAO limita a quantidade de perfis cadastrados.

ESTADOS DE PERFIL
=================
AVAILABLE
BUSY
LIMIT_REACHED
OFFLINE
PAUSED

REMOVER
=======
Remover um perfil do dashboard remove o cadastro da escala, mas a V4.0 preserva de proposito os dados do navegador no disco. Assim um clique acidental nao apaga cookies/login.

IMPORTANTE SOBRE O PRIMEIRO TESTE
=================================
Esta e a primeira versao que adiciona um processo Manager local e varias instancias Chrome.
O nucleo V3.2 (envio rapido, mapping, download, Failure Isolation e HARD STOP) foi preservado.
Primeiro valide cadastro/vinculo de dois perfis e o teste de troca por limite antes de colocar muitas contas em producao.

ARQUIVOS DE TESTE
=================
TESTE_V4_MULTI_PROFILE.txt
EXEMPLO_TESTE_LIMIT_TRANSFER_V4.txt

AUTO SETUP / REQUISITOS
========================
Nao e mais necessario instalar Node.js manualmente.
START_MANAGER.bat verifica as dependencias no CMD e prepara o ambiente automaticamente.

- Node.js 18+: reutiliza se ja existir; caso contrario baixa uma versao LTS portatil oficial para .runtime.
- Google Chrome: reutiliza se ja existir; caso contrario tenta instalar automaticamente.
- Nao ha npm install nesta versao, pois o Manager usa apenas modulos nativos do Node.js.

Se o fallback de instalacao do Chrome precisar de permissao administrativa, o Windows exibira a solicitacao uma vez.

Detalhes: AUTO_SETUP_V4_0_1.txt