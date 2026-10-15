@echo off
setlocal
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" (
  echo Microsoft Edge was not found.
  pause
  exit /b 1
)
set "PAGE=%~dp0index.html"
set "PAGE=%PAGE:\=/%"
start "" "%EDGE%" --app="file:///%PAGE%" --window-size=440,620
