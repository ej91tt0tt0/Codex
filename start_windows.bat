@echo off
title ASTER
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 goto usepython
py -3 launch.py
goto done
:usepython
python launch.py
:done
pause
