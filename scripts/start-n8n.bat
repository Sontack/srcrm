@echo off
echo ========================================================
echo  Starting n8n Automation Engine for WhatsApp CRM
echo ========================================================
echo.

docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed or not in your PATH.
    echo Please install Docker Desktop for Windows or run:
    echo   npx n8n
    pause
    exit /b 1
)

echo Checking for running n8n container...
docker compose -f docker-compose.n8n.yml up -d

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo  n8n is running successfully at http://localhost:5678
    echo  Embedded workspace: http://localhost:3000/n8n
    echo ========================================================
    echo.
    echo Next steps:
    echo 1. Open http://localhost:5678 to finish first-time admin setup if needed.
    echo 2. Go to Settings > n8n API in n8n, create an API Key, and paste it in WhatsApp CRM.
    echo 3. Open WhatsApp CRM at http://localhost:3000/n8n to start building!
) else (
    echo [ERROR] Failed to start n8n container with Docker Compose.
)

pause
