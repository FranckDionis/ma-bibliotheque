@echo off
setlocal
cd /d "%~dp0"
title Ma bibliotheque

if not exist "node_modules" (
    echo Premiere utilisation : installation des dependances...
    call npm install
)

start /min "Ma bibliotheque - serveur" cmd /k "npm run dev"

echo Demarrage du serveur, patientez...
timeout /t 6 /nobreak >nul

call :ouvrir "http://localhost:5173"
exit /b

REM --- Ouvre l'URL en mode application : fenetre dediee, sans barre d'adresse ---
:ouvrir
set "NAV="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "NAV=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "NAV=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined NAV if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "NAV=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined NAV if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "NAV=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if defined NAV (
    start "" "%NAV%" --app=%1 --window-size=1400,900
) else (
    start "" %1
)
exit /b
