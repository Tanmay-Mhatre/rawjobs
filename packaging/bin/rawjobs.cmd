@echo off
rem RawJobs launcher (Windows). It never changes between versions: it runs the version named in
rem app\current.txt with the Node named in runtime\current.txt, both inside this RawJobs folder.
setlocal
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set /p NODEV=<"%ROOT%\runtime\current.txt"
set /p APPV=<"%ROOT%\app\current.txt"
set "RAWJOBS_HOME=%ROOT%"
set "RAWJOBS_LAUNCHER=%ROOT%\bin\rawjobs.cmd"
"%ROOT%\runtime\%NODEV%\node.exe" "%ROOT%\app\versions\%APPV%\cli.mjs" %*
exit /b %ERRORLEVEL%
