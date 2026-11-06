@echo off
rem First-time setup: installs npm packages and downloads the gcsim CLI into tools\
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run setup.bat again.
  pause
  exit /b 1
)
call :checknode
if errorlevel 1 exit /b 1

echo [1/2] Installing packages...
call npm install
if errorlevel 1 (
  echo npm install failed. Check the internet connection and run setup.bat again.
  pause
  exit /b 1
)

echo [2/2] Downloading gcsim...
node scripts\setup-gcsim.mjs
if errorlevel 1 (
  echo gcsim download failed. You can also download it later from the app ^(Simulate - Download gcsim^).
)

echo.
echo Done. Run start.bat to open the builder.
pause
exit /b 0

:checknode
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=12)||(v[0]===20&&v[1]>=19)?0:1)"
if errorlevel 1 (
  for /f %%v in ('node -v') do echo Node.js %%v is too old: the builder needs 20.19+ or 22.12+.
  echo Install the current LTS from https://nodejs.org and run setup.bat again.
  pause
  exit /b 1
)
exit /b 0
