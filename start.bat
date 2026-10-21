@echo off
rem Starts the builder (with the local gcsim bridge) and opens it in the browser
cd /d "%~dp0"
if not exist node_modules (
  echo First run: installing...
  call setup.bat
)
start "" http://localhost:5179/
call npm run dev
