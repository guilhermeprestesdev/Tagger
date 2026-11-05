@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 server.py
  goto fim
)

where python >nul 2>nul
if %errorlevel%==0 (
  python server.py
  goto fim
)

echo O Python 3 nao foi encontrado neste computador.
echo Instale o Python 3 e execute este inicializador novamente.
pause

:fim
endlocal
