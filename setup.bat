@echo off
rem First-time setup: installs npm packages and downloads the gcsim CLI into tools\
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run setup.bat again.
  pause
  exit /b 1
)

echo [1/2] Installing packages...
call npm install
if errorlevel 1 (
  echo npm install failed.
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
