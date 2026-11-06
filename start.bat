@echo off
rem Starts the builder (with the local gcsim bridge) and opens it in the browser once the server is up
cd /d "%~dp0"
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=12)||(v[0]===20&&v[1]>=19)?0:1)" 2>nul
if errorlevel 1 (
  echo Node.js is missing or too old: the builder needs 20.19+ or 22.12+. Install the LTS from https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: installing...
  call setup.bat
  if not exist node_modules exit /b 1
)
call npm run dev -- --open
echo.
echo The builder stopped. If there is an error above:
echo  - "Port 5179 is already in use": the builder is already running (look for another window), or close what uses the port.
echo  - anything else: run setup.bat again, then start.bat.
pause
