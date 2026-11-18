# n8n Automation Workspace Integration Guide for WhatsApp CRM

## Overview

The WhatsApp CRM features a complete, deeply integrated **n8n Automation Workspace** (`/n8n`). This is not a simulated or fake canvas — it integrates directly with the **actual n8n workflow engine**, giving you full access to n8n's visual canvas, hundreds of nodes (WhatsApp, Google Sheets, Gmail, Telegram, OpenAI, Gemini, HTTP Request, Webhooks, Code, Database connectors), real-time execution telemetry, and workflow lifecycle management without ever leaving your CRM.

---

## 1. Quick Start Guide

### Option A: Running with the Included Docker Compose (Recommended)

1. Launch n8n using the automated script:
   - **Windows**: Double-click `scripts/start-n8n.bat` or run:
     ```cmd
     docker compose -f docker-compose.n8n.yml up -d
     ```
   - **Linux / macOS**:
     ```bash
     chmod +x scripts/start-n8n.sh
     ./scripts/start-n8n.sh
     ```
2. Open `http://localhost:5678` in your browser to create your initial n8n owner account (if running for the first time).
3. In n8n, navigate to **Settings** &gt; **n8n API** &gt; click **Create API Key**. Copy the key.
4. Go to your WhatsApp CRM at `http://localhost:3000/n8n`, switch to the **Settings** tab:
   - **Instance URL**: `http://localhost:5678`
   - **n8n API Key**: Paste your generated key
   - Click **Save Configuration** and then **Test Connection**.
5. Switch to the **Workflow Canvas** tab to start building directly inside your CRM!

### Option B: Connecting an Existing Cloud or Self-Hosted n8n Instance

If you already run n8n on a remote server (e.g. `https://n8n.mycompany.com`):
1. In your remote n8n, create an API key via **Settings** &gt; **n8n API**.
2. In WhatsApp CRM, enter `https://n8n.mycompany.com` as the Instance URL and paste the API Key.
3. Ensure reverse proxy embedding headers are configured (see Section 2).

---

## 2. Embedding Configuration & Browser Security Headers

Modern browsers enforce Content Security Policy (CSP) and `X-Frame-Options` on iframes. To allow the n8n canvas to render inside the WhatsApp CRM UI without browser blocking:

### A. n8n Environment Variables
In your n8n environment (or `docker-compose.n8n.yml`):
```env
N8N_PORT=5678
N8N_PROTOCOL=http
N8N_EDITOR_BASE_URL=http://localhost:5678
WEBHOOK_URL=http://localhost:5678/
N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true
```

### B. Reverse Proxy Headers (Nginx / Caddy / Cloudflare)
If you place n8n behind a reverse proxy (e.g., Nginx, Caddy, Cloudflare, Traefik), configure the `Content-Security-Policy` header to allow your CRM origin in `frame-ancestors`:

**Nginx Configuration:**
```nginx
server {
    server_name n8n.yourdomain.com;

    location / {
        proxy_pass http://localhost:5678;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Allow WhatsApp CRM to embed the editor
        add_header Content-Security-Policy "frame-ancestors 'self' http://localhost:3000 https://crm.yourdomain.com" always;
        proxy_hide_header X-Frame-Options;
    }
}
```

**Caddy Configuration:**
```caddy
n8n.yourdomain.com {
    reverse_proxy localhost:5678 {
        header_down Content-Security-Policy "frame-ancestors 'self' http://localhost:3000 https://crm.yourdomain.com"
    }
}
```

---

## 3. Supported WhatsApp CRM Events

WhatsApp CRM automatically fires bidirectional webhooks to n8n for major lifecycle events. You can map them globally or configure dedicated n8n webhook URLs per event in the **CRM Triggers** tab (`/n8n` &gt; **CRM Triggers**):

| Event Name | Trigger Condition | Payload Includes |
| :--- | :--- | :--- |
| `message.received` | Any inbound WhatsApp message (text, media, audio, document) | `phone`, `message`, `message_type`, `conversation_id`, `contact_name` |
| `contact.created` | New contact added manually, imported via CSV/Excel, or via first message | `phone`, `name`, `tags`, `custom_fields`, `created_at` |
| `broadcast.completed` | Mass broadcast campaign completes delivery | `campaign_name`, `broadcast_id`, `total_recipients`, `delivered`, `failed` |
| `conversation.handoff` | Customer requests live human agent or AI escalates chat | `conversation_id`, `phone`, `reason`, `last_message` |

### Sample Payload Sent to n8n Webhook:
```json
{
  "event": "message.received",
  "accountId": "00000000-0000-0000-0000-000000000000",
  "timestamp": "2026-11-18T10:45:00.000Z",
  "data": {
    "conversation_id": "c71a39f0-2101-4475-bf73-45300188b438",
    "phone": "+919876543210",
    "message": "Hello, I want to know about your enterprise pricing.",
    "message_type": "text"
  }
}
```

---

## 4. WhatsApp CRM Actions Callable from n8n

n8n workflows can perform operations in WhatsApp CRM via standard HTTP Request nodes:

### Send WhatsApp Message / Template:
- **Method**: `POST`
- **URL**: `http://localhost:3000/api/whatsapp/send`
- **Body**:
  ```json
  {
    "to": "+919876543210",
    "text": "Hello! Thank you for contacting our sales team."
  }
  ```

### AI Knowledge Base Auto-Reply:
- **Method**: `POST`
- **URL**: `http://localhost:3000/api/ai/reply`
- **Body**:
  ```json
  {
    "conversationId": "...",
    "prompt": "What are your support hours?"
  }
  ```

### Escalate to Human Agent:
- **Method**: `POST`
- **URL**: `http://localhost:3000/api/ai/handover`
- **Body**:
  ```json
  {
    "conversationId": "...",
    "reason": "Escalated by n8n customer workflow"
  }
  ```

---

## 5. Prebuilt Workflow Templates Included

Inside `/n8n` &gt; **Templates**, the following 1-click workflows are included ready to import directly into your n8n engine:

1. **WhatsApp AI Customer Support Bot & Handover**:
   Checks inbound messages, uses OpenAI or Gemini knowledge base for automated answers, and flags chat for human operators if customer asks for an agent.
2. **Sync Inbound WhatsApp Leads to Google Sheets**:
   Extracts customer name, phone number, and tags from new contacts and appends them to your central Google Sheet.
3. **Instant WhatsApp Order & Payment Confirmation**:
   Triggers on order/invoice events and delivers dynamic WhatsApp confirmation templates with invoice numbers and delivery details.
4. **Broadcast Completion Report & Slack/Telegram Alert**:
   Summarizes broadcast delivery statistics and pings your marketing channel on Telegram or Slack.
5. **Customer Satisfaction (CSAT/NPS) Survey Collector**:
   Sends quick reply rating buttons to contacts after ticket resolution and records customer feedback scores.

---

## 6. n8n Licensing Information

- **Internal Business Use**:
  Self-hosting n8n for your own company's internal automation and operations is permitted under the **n8n Sustainable Use License**.
- **Commercial Embedding / White-Label OEM**:
  If you offer this CRM as a multi-tenant SaaS to external third parties where n8n is packaged and resold as a paid commercial feature, you may require an **n8n OEM / Embed Commercial License** from n8n GmbH. Please visit [https://n8n.io/pricing/](https://n8n.io/pricing/) for official enterprise licensing details.

---

## 7. Security Architecture

1. **Encrypted at Rest**: All n8n API keys and authentication tokens are encrypted using **AES-256-GCM** before being saved to the database. They are never transmitted in plaintext to client browsers.
2. **Tenant Isolation**: All workflow queries and event dispatches are scoped strictly to the authenticated `account_id` via Supabase Row-Level Security (RLS).
3. **Role-Based Access Control**: Only users with the `admin` or `owner` role can modify connection credentials, event mappings, or delete workflows.
