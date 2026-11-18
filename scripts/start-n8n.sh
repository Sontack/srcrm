#!/usr/bin/env bash
set -e

echo "========================================================"
echo " Starting n8n Automation Engine for WhatsApp CRM"
echo "========================================================"
echo ""

if ! command -v docker &> /dev/null; then
    echo "[ERROR] Docker is not installed or not in PATH."
    echo "Install Docker or start n8n directly with: npx n8n"
    exit 1
fi

echo "Starting n8n container via docker-compose.n8n.yml..."
docker compose -f docker-compose.n8n.yml up -d

echo ""
echo "========================================================"
echo " n8n is running at: http://localhost:5678"
echo " Embedded workspace: http://localhost:3000/n8n"
echo "========================================================"
echo ""
echo "Next steps:"
echo "1. Visit http://localhost:5678 to finish initial setup."
echo "2. Go to Settings > n8n API in n8n, create an API Key, and save it in WhatsApp CRM."
echo "3. Open http://localhost:3000/n8n to access the embedded workflow canvas."
