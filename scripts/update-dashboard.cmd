@echo off
rem Update the Skill Hub dashboard (Windows).
rem   Double-click: rebuild and open in the default browser.
rem   update-dashboard.cmd /quiet : rebuild only, log to out\last-build.log (for scheduled tasks).
rem   update-dashboard.cmd /web   : rebuild only; used by the dashboard's update button
rem                                 (skillhub:// link, see: node bin\skill-hub.mjs protocol install).
rem                                 The open dashboard tab reloads itself when the build is done.
cd /d "%~dp0.."
if not exist out mkdir out

if /i "%~1"=="/web" (
  title Skill Hub
  echo Updating Skill Hub dashboard...
  node bin\skill-hub.mjs build > out\last-build.log 2>&1
  if errorlevel 1 (
    type out\last-build.log
    echo.
    echo Update failed. See the error above.
    pause
    exit /b 1
  )
  exit /b 0
)

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
