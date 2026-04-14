@echo off
cd /d %~dp0

python --version >nul 2>&1
if errorlevel 1 goto nopython

if not exist "backend_adapted.py" goto nobackend
if not exist "index.html" goto noindex

pip show flask >nul 2>&1
if errorlevel 1 pip install flask flask-cors pandas -q

start "TXO-Backend" cmd /k "cd /d %~dp0 && python backend_adapted.py"
timeout /t 3 /nobreak >nul
start "TXO-Frontend" cmd /k "cd /d %~dp0 && python -m http.server 8080"
timeout /t 2 /nobreak >nul
start http://localhost:8080
goto end

:nopython
echo Python not found. Please install Python 3.8+
pause
exit /b

:nobackend
echo backend_adapted.py not found
pause
exit /b

:noindex
echo index.html not found
pause
exit /b

:end
