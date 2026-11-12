@echo off
rem Installs the Reactio helper for the Overleaf extension (Chrome, Edge, Brave). No administrator rights needed.
setlocal
set "HERE=%~dp0"
set "TARGET=%LOCALAPPDATA%\ReactioOverleaf"
if not exist "%TARGET%" mkdir "%TARGET%"
set "NAME=reactio-overleaf-host.exe"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "NAME=reactio-overleaf-host-arm64.exe"
rem Beside this script in a release download, or in dist\host in the source tree.
set "SRC=%HERE%%NAME%"
if not exist "%SRC%" set "SRC=%HERE%..\dist\host\%NAME%"
copy /y "%SRC%" "%TARGET%\reactio-overleaf-host.exe" >nul
set "EXE=%TARGET%\reactio-overleaf-host.exe"
set "JSON=%TARGET%\com.reactio.overleaf.json"
powershell -NoProfile -Command "$m = [ordered]@{ name='com.reactio.overleaf'; description='Reactio Draw figures for Overleaf: opens drawings in Reactio Draw'; path=$env:EXE; type='stdio'; allowed_origins=@('chrome-extension://hjkdmdfdknjjfdaepbeggimajobinoeg/') }; [IO.File]::WriteAllText($env:JSON, ($m | ConvertTo-Json))"
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.reactio.overleaf" /ve /t REG_SZ /d "%JSON%" /f >nul
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.reactio.overleaf" /ve /t REG_SZ /d "%JSON%" /f >nul
reg add "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.reactio.overleaf" /ve /t REG_SZ /d "%JSON%" /f >nul
reg add "HKCU\Software\Chromium\NativeMessagingHosts\com.reactio.overleaf" /ve /t REG_SZ /d "%JSON%" /f >nul
"%EXE%" --version
echo Done. Reload the Overleaf page.
pause
