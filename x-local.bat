@echo off
REM ============================================================
REM  O X DA YUNA, PELO SEU COMPUTADOR
REM
REM  Ela escreve no motor (que roda na nuvem) e este programa
REM  publica no X pelo SEU navegador e pelo SEU IP. Sem proxy,
REM  sem custo. Deixe esta janela aberta.
REM
REM  PRIMEIRA VEZ: uma janela do Chrome abre. Faca login como
REM  @yunaagent nela. Depois disso ele lembra pra sempre.
REM
REM  Para testar sem publicar de verdade, troque X_LOCAL_PUBLICAR
REM  de 1 para 0: ele escreve o texto e nao clica em Post.
REM
REM  X_LOCAL_INTERVALO_S=1200 e um post a cada 20 min (3 por hora).
REM  X_LOCAL_MENCOES_MIN=10 e de quanto em quanto tempo ele le as
REM  mencoes dela e entrega ao motor, pra ela poder responder.
REM  Ela escreve no maximo 9 por dia, entao o ritmo nunca estoura
REM  o limite de 500/mes do tier gratuito do X.
REM ============================================================
title Yuna - X local
cd /d "C:\Higgsfield Games\yuna"

set ADMIN_TOKEN=Tin2xQhKZ5Wj_oDnBg4QoTvNUIQzyLfv
set YUNA_URL=https://yuna.cam
set X_LOCAL_INTERVALO_S=1200
set X_LOCAL_PUBLICAR=1
set X_LOCAL_MENCOES_MIN=10

echo.
echo  Vigiando a fila da Yuna. Feche esta janela para parar.
echo.
node scripts\x-local.mjs

echo.
echo  O programa parou.
pause
