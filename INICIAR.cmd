@echo off
REM ===================================================================
REM  Enciende Vector2 en tu computadora. Doble clic sobre este archivo
REM  y listo. Para apagarlo, cierra esta ventana.
REM ===================================================================
title Vector2 - Planificacion de producto Lukers
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [X] No encuentro Node.js en esta computadora.
  echo      Instalalo con:  winget install OpenJS.NodeJS.LTS --scope user
  echo      y vuelve a abrir esta ventana.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo  Primera vez: instalando componentes. Esto tarda unos minutos...
  echo.
  call npm install --no-fund --no-audit
)

if not exist ".env.local" (
  echo.
  echo  [X] Falta el archivo .env.local
  echo      Copia .env.local.example como .env.local y completa las tres llaves
  echo      de Supabase (Project Settings ^> API Keys).
  echo.
  pause
  exit /b 1
)

findstr /b /c:"SUPABASE_SERVICE_ROLE_KEY=" .env.local | findstr /r /c:"=.\+" >nul
if errorlevel 1 (
  echo.
  echo  [!] AVISO: la llave secreta esta vacia en .env.local
  echo      El sistema abre, pero ninguna pantalla va a cargar datos.
  echo.
  pause
)

echo.
echo  ===================================================
echo   Encendiendo... espera a que diga  Ready
echo   Despues abre el navegador en:  http://localhost:3000
echo.
echo   Para apagar: cierra esta ventana.
echo  ===================================================
echo.

call npm run dev
pause
