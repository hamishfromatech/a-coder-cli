@echo off
REM Run the A-Coder CLI with debug mode to diagnose the skills tool issue
REM Make sure the project is built first

cd /d "%~dp0"

echo Building the project...
call npm run build

echo.
echo Running with debug mode...
call npm start -- --debug