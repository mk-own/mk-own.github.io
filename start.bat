@echo off
rem My Hub local run: start server (saves encrypted data into this folder), then open browser
cd /d "%~dp0"
start "MyHub server" /min python server.py
timeout /t 1 /nobreak >nul
start "" http://127.0.0.1:8765/
