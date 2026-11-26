@echo off
cd /d "%~dp0"
set PORT=8000

set PY=
where python >nul 2>nul
if %errorlevel%==0 set PY=python
if not defined PY (
  where py >nul 2>nul
  if %errorlevel%==0 set PY=py
)
if not defined PY goto nopython

echo Starting My Weekly Routine on http://localhost:%PORT%
echo Keep this window open while you use the app. Close it to stop.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%"
%PY% -m http.server %PORT%
goto end

:nopython
echo Python was not found. Install it from python.org
echo and tick "Add python.exe to PATH" during setup.
pause

:end
