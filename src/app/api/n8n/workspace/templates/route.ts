import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { getN8nClientForAccount } from '@/lib/n8n/client';

export interface PrebuiltTemplate {
  id: string;
  name: string;
  category: 'AI & Chatbots' | 'Leads & CRM' | 'E-Commerce & Orders' | 'Notifications & Alerts' | 'Surveys & Feedback';
  description: string;
  tags: string[];
  nodesCount: number;
  triggerEvent: string;
  workflow: {
    name: string;
    nodes: unknown[];
    connections: Record<string, unknown>;
    settings?: Record<string, unknown>;
  };
}

export const PREBUILT_TEMPLATES: PrebuiltTemplate[] = [
  {
    id: 'whatsapp-ai-support-bot',
    name: 'WhatsApp AI Customer Support Bot & Handover',
    category: 'AI & Chatbots',
    description: 'Autonomous customer support bot that checks CRM knowledge base, answers FAQs, and automatically escalates to a human agent when needed.',
    tags: ['WhatsApp', 'AI', 'OpenAI', 'Gemini', 'Customer Support'],
    nodesCount: 5,
    triggerEvent: 'message.received',
    workflow: {
      name: 'WhatsApp AI Customer Support & Handover',
      nodes: [
        {
          id: 'n1',
          name: 'WhatsApp CRM Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [240, 300],
          parameters: {
            path: 'whatsapp-ai-support',
            httpMethod: 'POST',
            responseMode: 'onReceived',
            options: {},
          },
        },
        {
          id: 'n2',
          name: 'Check If Human Needed',
          type: 'n8n-nodes-base.if',
          typeVersion: 2,
          position: [460, 300],
          parameters: {
            conditions: {
              string: [
                {
                  value1: '={{ $json.body.data.message || "" }}',
                  operation: 'regex',
                  value2: '(?i)(human|agent|operator|person|support|help me)',
                },
              ],
            },
          },
        },
        {
          id: 'n3',
          name: 'Handover to Human Agent',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [700, 200],
          parameters: {
            method: 'POST',
            url: '={{ $json.body.crm_base_url || "http://localhost:3000" }}/api/ai/handover',
            sendBody: true,
            bodyParameters: {
              parameters: [
                { name: 'conversationId', value: '={{ $json.body.data.conversation_id }}' },
                { name: 'reason', value: 'Customer requested human agent in n8n workflow' },
              ],
            },
          },
        },
        {
          id: 'n4',
          name: 'AI Knowledge Answer (OpenAI/Gemini)',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [700, 420],
          parameters: {
            method: 'POST',
            url: '={{ $json.body.crm_base_url || "http://localhost:3000" }}/api/ai/reply',
            sendBody: true,
            bodyParameters: {
              parameters: [
                { name: 'conversationId', value: '={{ $json.body.data.conversation_id }}' },
                { name: 'prompt', value: '={{ $json.body.data.message }}' },
              ],
            },
          },
        },
        {
          id: 'n5',
          name: 'Send WhatsApp Reply',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [940, 420],
          parameters: {
            method: 'POST',
            url: '={{ $json.body.crm_base_url || "http://localhost:3000" }}/api/whatsapp/send',
            sendBody: true,
            bodyParameters: {
              parameters: [
                { name: 'to', value: '={{ $json.body.data.phone }}' },
                { name: 'text', value: '={{ $json.reply || $json.body.data.suggested_reply }}' },
              ],
            },
          },
        },
      ],
      connections: {
        'WhatsApp CRM Webhook': {
          main: [[{ node: 'Check If Human Needed', type: 'main', index: 0 }]],
        },
        'Check If Human Needed': {
          main: [
            [{ node: 'Handover to Human Agent', type: 'main', index: 0 }],
            [{ node: 'AI Knowledge Answer (OpenAI/Gemini)', type: 'main', index: 0 }],
          ],
        },
        'AI Knowledge Answer (OpenAI/Gemini)': {
          main: [[{ node: 'Send WhatsApp Reply', type: 'main', index: 0 }]],
        },
      },
    },
  },
  {
    id: 'whatsapp-leads-google-sheets',
    name: 'Sync Inbound WhatsApp Leads to Google Sheets',
    category: 'Leads & CRM',
    description: 'Automatically captures newly created contacts and inbound inquiries, validates details, and appends them to your central Google Sheet.',
    tags: ['Google Sheets', 'Contacts', 'Leads', 'Automation'],
    nodesCount: 3,
    triggerEvent: 'contact.created',
    workflow: {
      name: 'Sync Inbound WhatsApp Leads to Google Sheets',
      nodes: [
        {
          id: 'n1',
          name: 'Contact Created Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [240, 300],
          parameters: {
            path: 'lead-sync-sheets',
            httpMethod: 'POST',
            responseMode: 'onReceived',
          },
        },
        {
          id: 'n2',
          name: 'Format Contact Data',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [480, 300],
          parameters: {
            jsCode: `return [{
  json: {
    Name: $input.item.json.body.data.name || 'WhatsApp Contact',
    Phone: $input.item.json.body.data.phone || '',
    Tags: ($input.item.json.body.data.tags || []).join(', '),
    CreatedAt: new Date().toISOString(),
    Source: 'WhatsApp CRM'
  }
}];`,
          },
        },
        {
          id: 'n3',
          name: 'Append to Google Sheet',
          type: 'n8n-nodes-base.googleSheets',
          typeVersion: 4.5,
          position: [720, 300],
          parameters: {
            operation: 'append',
            sheetName: 'WhatsApp Leads',
            columns: {
              mappingMode: 'autoMapInputData',
            },
          },
        },
      ],
      connections: {
        'Contact Created Webhook': {
          main: [[{ node: 'Format Contact Data', type: 'main', index: 0 }]],
        },
        'Format Contact Data': {
          main: [[{ node: 'Append to Google Sheet', type: 'main', index: 0 }]],
        },
      },
    },
  },
  {
    id: 'whatsapp-order-payment-confirmation',
    name: 'Instant WhatsApp Order & Payment Confirmation',
    category: 'E-Commerce & Orders',
    description: 'Sends rich WhatsApp confirmation templates with invoice numbers, amounts, and tracking links when orders or payments are received.',
    tags: ['E-Commerce', 'Orders', 'Payments', 'Templates'],
    nodesCount: 3,
    triggerEvent: 'order.completed',
    workflow: {
      name: 'WhatsApp Order & Payment Confirmation',
      nodes: [
        {
          id: 'n1',
          name: 'Order Webhook Trigger',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [240, 300],
          parameters: {
            path: 'order-confirmed',
            httpMethod: 'POST',
            responseMode: 'onReceived',
          },
        },
        {
          id: 'n2',
          name: 'Format Confirmation Message',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [480, 300],
          parameters: {
            jsCode: `const data = $input.item.json.body.data || {};
return [{
  json: {
    to: data.phone,
    templateName: 'order_confirmation',
    parameters: [
      { type: 'text', text: data.customer_name || 'Valued Customer' },
      { type: 'text', text: data.order_id || 'ORD-1001' },
      { type: 'text', text: String(data.total_amount || '0.00') },
      { type: 'text', text: data.delivery_date || 'Within 2 business days' }
    ]
  }
}];`,
          },
        },
        {
          id: 'n3',
          name: 'Send WhatsApp Template',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [720, 300],
          parameters: {
            method: 'POST',
            url: '={{ $json.body.crm_base_url || "http://localhost:3000" }}/api/whatsapp/send',
            sendBody: true,
            bodyParameters: {
              parameters: [
                { name: 'to', value: '={{ $json.to }}' },
                { name: 'template', value: '={{ $json.templateName }}' },
                { name: 'parameters', value: '={{ $json.parameters }}' },
              ],
            },
          },
        },
      ],
      connections: {
        'Order Webhook Trigger': {
          main: [[{ node: 'Format Confirmation Message', type: 'main', index: 0 }]],
        },
        'Format Confirmation Message': {
          main: [[{ node: 'Send WhatsApp Template', type: 'main', index: 0 }]],
        },
      },
    },
  },
  {
    id: 'broadcast-completion-manager-alert',
    name: 'Broadcast Completion Report & Slack/Telegram Alert',
    category: 'Notifications & Alerts',
    description: 'When a broadcast campaign finishes sending, compiles total sent, delivered, failed, and read metrics and notifies managers on Slack or Telegram.',
    tags: ['Broadcasts', 'Analytics', 'Slack', 'Telegram', 'Reports'],
    nodesCount: 3,
    triggerEvent: 'broadcast.completed',
    workflow: {
      name: 'Broadcast Completion Report & Slack/Telegram Alert',
      nodes: [
        {
          id: 'n1',
          name: 'Broadcast Completed Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [240, 300],
          parameters: {
            path: 'broadcast-completed-alert',
            httpMethod: 'POST',
            responseMode: 'onReceived',
          },
        },
        {
          id: 'n2',
          name: 'Format Campaign Stats',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [480, 300],
          parameters: {
            jsCode: `const data = $input.item.json.body.data || {};
const text = \`📢 *WhatsApp Campaign Finished: \${data.campaign_name || 'Broadcast'}*
• Total Recipients: \${data.total_recipients || 0}
• Delivered: \${data.delivered || 0}
• Failed: \${data.failed || 0}
• Delivery Rate: \${data.total_recipients ? Math.round((data.delivered / data.total_recipients) * 100) : 0}%\`;
return [{ json: { summary: text } }];`,
          },
        },
        {
          id: 'n3',
          name: 'Send Manager Alert',
          type: 'n8n-nodes-base.telegram',
          typeVersion: 1.2,
          position: [720, 300],
          parameters: {
            chatId: 'YOUR_CHAT_ID',
            text: '={{ $json.summary }}',
          },
        },
      ],
      connections: {
        'Broadcast Completed Webhook': {
          main: [[{ node: 'Format Campaign Stats', type: 'main', index: 0 }]],
        },
        'Format Campaign Stats': {
          main: [[{ node: 'Send Manager Alert', type: 'main', index: 0 }]],
        },
      },
    },
  },
  {
    id: 'whatsapp-interactive-nps-survey',
    name: 'Customer Satisfaction (CSAT/NPS) Survey Collector',
    category: 'Surveys & Feedback',
    description: 'Sends interactive rating buttons (1 to 5) after ticket resolution, collects scores, and tags contacts with "High Value" or "Needs Follow-up".',
    tags: ['Surveys', 'CSAT', 'NPS', 'Feedback', 'Interactive'],
    nodesCount: 3,
    triggerEvent: 'conversation.handoff',
    workflow: {
      name: 'Customer Satisfaction (CSAT/NPS) Survey Collector',
      nodes: [
        {
          id: 'n1',
          name: 'Resolution Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [240, 300],
          parameters: {
            path: 'survey-trigger',
            httpMethod: 'POST',
            responseMode: 'onReceived',
          },
        },
        {
          id: 'n2',
          name: 'Send Quick Reply Survey',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [480, 300],
          parameters: {
            method: 'POST',
            url: '={{ $json.body.crm_base_url || "http://localhost:3000" }}/api/whatsapp/send',
            sendBody: true,
            bodyParameters: {
              parameters: [
                { name: 'to', value: '={{ $json.body.data.phone }}' },
                { name: 'text', value: 'How was your support experience today? Please tap a rating below:' },
                {
                  name: 'buttons',
                  value: JSON.stringify([
                    { id: 'rate_5', text: '⭐⭐⭐⭐⭐ Excellent' },
                    { id: 'rate_3', text: '⭐⭐⭐ Average' },
                    { id: 'rate_1', text: '⭐ Poor' },
                  ]),
                },
              ],
            },
          },
        },
      ],
      connections: {
        'Resolution Webhook': {
          main: [[{ node: 'Send Quick Reply Survey', type: 'main', index: 0 }]],
        },
      },
    },
  },
];

export async function GET() {
  try {
    return NextResponse.json({ templates: PREBUILT_TEMPLATES });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { client } = await getN8nClientForAccount(supabase, accountId);

    if (!client) {
      return NextResponse.json(
        { error: 'n8n instance is not configured. Connect your n8n instance first.' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { templateId, workflowJson, templateName } = body;

    let workflowData: {
      name: string;
      nodes: unknown[];
      connections: Record<string, unknown>;
      settings?: Record<string, unknown>;
      tags?: string[];
    } | null = null;

    if (templateId) {
      const match = PREBUILT_TEMPLATES.find((t) => t.id === templateId);
      if (!match) {
        return NextResponse.json({ error: `Template with ID "${templateId}" not found.` }, { status: 404 });
      }
      workflowData = {
        name: templateName || match.workflow.name,
        nodes: match.workflow.nodes,
        connections: match.workflow.connections,
        settings: match.workflow.settings || {},
        tags: match.tags,
      };
    } else if (workflowJson) {
      try {
        const parsed = typeof workflowJson === 'string' ? JSON.parse(workflowJson) : workflowJson;
        workflowData = {
          name: templateName || parsed.name || 'Imported n8n Workflow',
          nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
          connections: parsed.connections || {},
          settings: parsed.settings || {},
          tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        };
      } catch (parseErr) {
        return NextResponse.json({ error: 'Invalid workflow JSON format.' }, { status: 400 });
      }
    }

    if (!workflowData || !workflowData.name) {
      return NextResponse.json({ error: 'Valid templateId or workflowJson is required.' }, { status: 400 });
    }

    const result = await client.createWorkflow(workflowData);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      workflow: result.workflow,
      message: `Workflow "${workflowData.name}" created successfully in n8n!`,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
