@echo off
rem Worship Caster - made by Easy Pastor Lee Kwangbok
set "WC_DATA_DIR=%APPDATA%\WorshipCaster"
if not exist "%WC_DATA_DIR%" mkdir "%WC_DATA_DIR%"
cd /d "%~dp0app"
start "WorshipCaster (close this window to quit)" /min "%~dp0node\node.exe" server.js
