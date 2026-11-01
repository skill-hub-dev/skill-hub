@echo off
rem Update the Skill Hub dashboard (Windows).
rem   Double-click: rebuild and open in the default browser.
rem   update-dashboard.cmd /quiet : rebuild only, log to out\last-build.log (for scheduled tasks).
cd /d "%~dp0.."
if not exist out mkdir out

if /i "%~1"=="/quiet" (
  node bin\skill-hub.mjs build > out\last-build.log 2>&1
  exit /b %errorlevel%
)

node bin\skill-hub.mjs build --open
if errorlevel 1 (
  echo.
  echo Update failed. See the error above. First time? Run: node bin\skill-hub.mjs init
  pause
)
