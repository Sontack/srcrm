'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Webhook,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Plus,
  Trash2,
  ExternalLink,
  Copy,
  Check,
  FileCode,
  Layers,
  Settings2,
  Power,
  Pencil,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/hooks/use-auth';
import type { MessageTemplate } from '@/types';

interface N8nConfig {
  configured: boolean;
  webhook_url: string;
  has_api_key: boolean;
  auth_header_name: string;
  has_auth_header_value: boolean;
  events: string[];
  status: 'connected' | 'disconnected' | 'error';
  last_tested_at?: string;
  last_error?: string;
}

export function N8nSettings() {
  const { accountId, canEditSettings } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Form State
  const [webhookUrl, setWebhookUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [authHeaderName, setAuthHeaderName] = useState('');
  const [authHeaderValue, setAuthHeaderValue] = useState('');
  const [hasExistingHeaderVal, setHasExistingHeaderVal] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<string[]>([
    'message.received',
    'contact.created',
    'broadcast.completed',
  ]);
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');
  const [lastTestedAt, setLastTestedAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // Inbound webhook URL copy state
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  // Templates from n8n state
  const [n8nTemplates, setN8nTemplates] = useState<MessageTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState({
    id: '',
    name: '',
    category: 'Utility' as 'Utility' | 'Marketing' | 'Authentication',
    body_text: '',
    footer_text: '',
  });
  const [jsonInput, setJsonInput] = useState('');
  const [activeImportTab, setActiveImportTab] = useState<'form' | 'json'>('form');
  const [importingTemplate, setImportingTemplate] = useState(false);

  const inboundWebhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/n8n/webhook`
    : '/api/n8n/webhook';

  useEffect(() => {
    loadConfig();
    loadTemplates();
  }, []);

  async function loadConfig() {
    setLoading(true);
    try {
      const res = await fetch('/api/n8n/config');
      if (res.ok) {
        const data: N8nConfig = await res.json();
        setWebhookUrl(data.webhook_url || '');
        setHasExistingKey(data.has_api_key);
        setAuthHeaderName(data.auth_header_name || '');
        setHasExistingHeaderVal(data.has_auth_header_value);
        setSelectedEvents(data.events || ['message.received', 'contact.created', 'broadcast.completed']);
        setStatus(data.status || 'disconnected');
        setLastTestedAt(data.last_tested_at || null);
        setLastError(data.last_error || null);
      }
    } catch (err) {
      console.error('Failed to load n8n config:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadTemplates() {
    setLoadingTemplates(true);
    try {
      const res = await fetch('/api/n8n/templates?source=n8n');
      if (res.ok) {
        const data = await res.json();
        setN8nTemplates(data.templates || []);
      }
    } catch (err) {
      console.error('Failed to load n8n templates:', err);
    } finally {
      setLoadingTemplates(false);
    }
  }

  async function handleSaveConfig() {
    if (!canEditSettings) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        webhook_url: webhookUrl,
        events: selectedEvents,
        status: webhookUrl ? (status === 'error' ? 'error' : 'connected') : 'disconnected',
      };

      if (apiKey) payload.api_key = apiKey;
      if (authHeaderName) payload.auth_header_name = authHeaderName;
      if (authHeaderValue) payload.auth_header_value = authHeaderValue;

      const res = await fetch('/api/n8n/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save configuration');
      }

      toast.success('n8n integration settings saved successfully');
      setApiKey('');
      setAuthHeaderValue('');
      await loadConfig();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error saving settings';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    if (!webhookUrl) {
      toast.error('Please enter an n8n Webhook URL before testing');
      return;
    }

    setTesting(true);
    try {
      const res = await fetch('/api/n8n/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_url: webhookUrl,
          api_key: apiKey || undefined,
          auth_header_name: authHeaderName || undefined,
          auth_header_value: authHeaderValue || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('Connection successful! n8n webhook responded properly.');
        setStatus('connected');
        setLastError(null);
        setLastTestedAt(new Date().toISOString());
      } else {
        toast.error(`Connection failed: ${data.error || 'Could not reach webhook'}`);
        setStatus('error');
        setLastError(data.error || 'Connection failed');
      }
    } catch (err) {
      toast.error('Network error testing connection to n8n');
      setStatus('error');
    } finally {
      setTesting(false);
    }
  }

  function handleEventToggle(ev: string) {
    if (selectedEvents.includes(ev)) {
      setSelectedEvents(selectedEvents.filter((e) => e !== ev));
    } else {
      setSelectedEvents([...selectedEvents, ev]);
    }
  }

  async function handleImportTemplateSubmit() {
    setImportingTemplate(true);
    try {
      let payload: Record<string, unknown>;

      if (activeImportTab === 'json') {
        try {
          payload = JSON.parse(jsonInput);
        } catch {
          toast.error('Invalid JSON format. Please check your syntax.');
          setImportingTemplate(false);
          return;
        }
      } else {
        if (!templateForm.name.trim() || !templateForm.body_text.trim()) {
          toast.error('Template name and body text are required');
          setImportingTemplate(false);
          return;
        }
        payload = {
          name: templateForm.name,
          category: templateForm.category,
          body_text: templateForm.body_text,
          footer_text: templateForm.footer_text || undefined,
          source: 'n8n',
        };
      }

      const res = await fetch('/api/n8n/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to import template');
      }

      toast.success('Template imported successfully from n8n!');
      setImportDialogOpen(false);
      setTemplateForm({ id: '', name: '', category: 'Utility', body_text: '', footer_text: '' });
      setJsonInput('');
      loadTemplates();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error importing template';
      toast.error(msg);
    } finally {
      setImportingTemplate(false);
    }
  }

  async function handleToggleTemplateEnabled(id: string, current: boolean) {
    try {
      const res = await fetch('/api/n8n/templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_enabled: !current }),
      });

      if (!res.ok) throw new Error('Failed to update template status');
      toast.success(`Template ${!current ? 'enabled' : 'disabled'}`);
      loadTemplates();
    } catch {
      toast.error('Failed to toggle template status');
    }
  }

  async function handleDeleteTemplate(id: string) {
    if (!confirm('Are you sure you want to remove this imported template?')) return;
    try {
      const res = await fetch(`/api/n8n/templates?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete template');
      toast.success('Template removed');
      loadTemplates();
    } catch {
      toast.error('Failed to delete template');
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
    toast.success('Copied to clipboard');
  }

  function insertVariable(varName: string) {
    setTemplateForm((prev) => ({
      ...prev,
      body_text: `${prev.body_text} {{${varName}}}`,
    }));
  }

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <Card className="border-border/80 bg-card">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 ring-1 ring-purple-500/20">
                <Webhook className="size-5" />
              </div>
              <div>
                <CardTitle className="text-lg">n8n Workflow Automation</CardTitle>
                <CardDescription>
                  Connect your n8n workflows, import message templates, and trigger events seamlessly.
                </CardDescription>
              </div>
            </div>

            {/* Status Badge */}
            <div className="flex items-center gap-2">
              {status === 'connected' && (
                <Badge variant="outline" className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                  <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Connected
                </Badge>
              )}
              {status === 'error' && (
                <Badge variant="outline" className="gap-1.5 border-rose-500/30 bg-rose-500/10 text-rose-400">
                  <XCircle className="size-3" />
                  Connection Error
                </Badge>
              )}
              {status === 'disconnected' && (
                <Badge variant="outline" className="gap-1.5 border-muted-foreground/30 bg-muted/40 text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-muted-foreground" />
                  Disconnected
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Outbound Webhook Section */}
          <div className="space-y-4 rounded-xl border border-border/80 bg-background/50 p-4">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Outbound Connection (WACRM → n8n)</h4>
              <p className="text-xs text-muted-foreground">
                WACRM will forward selected events and messages to this n8n webhook in real-time.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <Label htmlFor="webhook-url" className="text-xs">
                  n8n Webhook URL <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="webhook-url"
                  placeholder="https://n8n.example.com/webhook/wacrm-events"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="mt-1 font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="api-key" className="text-xs">
                    Bearer Token / API Key (Optional)
                  </Label>
                  <Input
                    id="api-key"
                    type="password"
                    placeholder={hasExistingKey ? '•••••••••••• (Encrypted in DB)' : 'Enter n8n token'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="mt-1 text-xs"
                  />
                </div>

                <div>
                  <Label htmlFor="custom-header-name" className="text-xs">
                    Custom Auth Header (Optional)
                  </Label>
                  <div className="mt-1 flex gap-2">
                    <Input
                      id="custom-header-name"
                      placeholder="e.g. X-N8N-KEY"
                      value={authHeaderName}
                      onChange={(e) => setAuthHeaderName(e.target.value)}
                      className="w-1/2 text-xs"
                    />
                    <Input
                      type="password"
                      placeholder={hasExistingHeaderVal ? '••••••••' : 'Header Value'}
                      value={authHeaderValue}
                      onChange={(e) => setAuthHeaderValue(e.target.value)}
                      className="w-1/2 text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Event selection */}
              <div>
                <Label className="text-xs">Events to Forward to n8n</Label>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    { id: 'message.received', label: 'Incoming Messages (message.received)', desc: 'Forward customer WhatsApp replies' },
                    { id: 'contact.created', label: 'New Contacts (contact.created)', desc: 'When new contacts are imported or saved' },
                    { id: 'broadcast.completed', label: 'Broadcasts (broadcast.completed)', desc: 'Notify when campaigns finish sending' },
                    { id: 'conversation.handoff', label: 'AI Handoff (conversation.handoff)', desc: 'When bot transfers to human or vice-versa' },
                  ].map((ev) => (
                    <label
                      key={ev.id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/60 bg-card/60 p-2.5 text-xs transition-colors hover:bg-card"
                    >
                      <input
                        type="checkbox"
                        checked={selectedEvents.includes(ev.id)}
                        onChange={() => handleEventToggle(ev.id)}
                        className="mt-0.5 rounded border-muted-foreground/40 text-primary focus:ring-primary"
                      />
                      <div>
                        <div className="font-medium text-foreground">{ev.label}</div>
                        <div className="text-[11px] text-muted-foreground">{ev.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Test connection & Save */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60">
              <div className="text-[11px] text-muted-foreground">
                {lastTestedAt && (
                  <span>
                    Last tested: {new Date(lastTestedAt).toLocaleTimeString()}
                    {lastError && <span className="ml-2 text-rose-400">({lastError})</span>}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={testing || !webhookUrl}
                  className="gap-1.5 text-xs"
                >
                  {testing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                  Test Connection
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveConfig}
                  disabled={saving || !canEditSettings}
                  className="gap-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {saving && <Loader2 className="size-3.5 animate-spin" />}
                  Save Settings
                </Button>
              </div>
            </div>
          </div>

          {/* Inbound Webhook (n8n -> CRM) */}
          <div className="space-y-3 rounded-xl border border-border/80 bg-background/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Inbound API & Webhook (n8n → WACRM)</h4>
                <p className="text-xs text-muted-foreground">
                  Use this endpoint in n8n HTTP Request nodes to push templates, sync contacts, or trigger messages.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={inboundWebhookUrl}
                className="bg-muted/40 font-mono text-xs text-muted-foreground"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(inboundWebhookUrl)}
                className="gap-1 text-xs"
              >
                {copiedWebhook ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                Copy URL
              </Button>
            </div>

            <div className="rounded-lg bg-card/80 p-3 text-[11px] font-mono text-muted-foreground border border-border/60">
              <span className="text-primary font-semibold">Supported Actions:</span>
              <ul className="mt-1 space-y-0.5 list-disc list-inside">
                <li><code className="text-purple-400">template.create</code> - Import / update a WhatsApp template from n8n</li>
                <li><code className="text-purple-400">contact.create</code> - Upsert a contact with name, phone, tags</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* WhatsApp Template Import from n8n */}
      <Card className="border-border/80 bg-card">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg">WhatsApp Templates from n8n</CardTitle>
              <CardDescription>
                Import and manage message templates created or synced from your n8n workflows.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={loadTemplates}
                disabled={loadingTemplates}
                className="gap-1.5 text-xs"
              >
                <RefreshCw className={loadingTemplates ? 'size-3.5 animate-spin' : 'size-3.5'} />
                Refresh
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setImportDialogOpen(true)}
                className="gap-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="size-3.5" />
                Import Template from n8n
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loadingTemplates ? (
            <div className="py-8 flex justify-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : n8nTemplates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 p-8 text-center">
              <FileCode className="mx-auto size-8 text-muted-foreground/60" />
              <p className="mt-2 text-sm font-medium text-foreground">No n8n templates imported yet</p>
              <p className="text-xs text-muted-foreground">
                Click &quot;Import Template from n8n&quot; or send a webhook from your n8n workflow to import templates.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {n8nTemplates.map((template) => (
                <div
                  key={template.id}
                  className="flex flex-col gap-3 rounded-xl border border-border/80 bg-background/50 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium text-foreground truncate">
                        {template.name}
                      </span>
                      <Badge variant="outline" className="border-purple-500/30 bg-purple-500/10 text-[10px] text-purple-400">
                        n8n
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {template.category}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={template.is_enabled ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px]' : 'text-muted-foreground text-[10px]'}
                      >
                        {template.is_enabled ? 'Active' : 'Disabled'}
                      </Badge>
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-2 font-sans">
                      {template.body_text}
                    </p>

                    {template.footer_text && (
                      <p className="text-[11px] text-muted-foreground/75 italic">
                        {template.footer_text}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleTemplateEnabled(template.id, !!template.is_enabled)}
                      className="h-8 text-xs gap-1"
                    >
                      <Power className="size-3" />
                      {template.is_enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteTemplate(template.id)}
                      className="h-8 text-xs text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import Modal */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl border-border bg-popover text-popover-foreground">
          <DialogHeader>
            <DialogTitle>Import WhatsApp Template from n8n</DialogTitle>
            <DialogDescription>
              Create or import a template with variable mappings (e.g. &#123;&#123;name&#125;&#125;, &#123;&#123;phone&#125;&#125;, &#123;&#123;service&#125;&#125;, &#123;&#123;amount&#125;&#125;, &#123;&#123;date&#125;&#125;) for broadcast campaigns.
            </DialogDescription>
          </DialogHeader>

          {/* Tab Selector */}
          <div className="flex border-b border-border/80">
            <button
              type="button"
              onClick={() => setActiveImportTab('form')}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeImportTab === 'form'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Visual Builder
            </button>
            <button
              type="button"
              onClick={() => setActiveImportTab('json')}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeImportTab === 'json'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Paste n8n JSON
            </button>
          </div>

          {activeImportTab === 'form' ? (
            <div className="space-y-4 py-3">
              <div>
                <Label htmlFor="tpl-name" className="text-xs">
                  Template Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="tpl-name"
                  placeholder="e.g. service_due_reminder"
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                  className="mt-1 text-xs font-mono"
                />
                <span className="text-[10px] text-muted-foreground">
                  Lowercase alphanumeric with underscores only.
                </span>
              </div>

              <div>
                <Label className="text-xs">Category</Label>
                <select
                  value={templateForm.category}
                  onChange={(e) =>
                    setTemplateForm({
                      ...templateForm,
                      category: e.target.value as 'Utility' | 'Marketing' | 'Authentication',
                    })
                  }
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="Utility">Utility</option>
                  <option value="Marketing">Marketing</option>
                  <option value="Authentication">Authentication</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="tpl-body" className="text-xs">
                    Body Text <span className="text-destructive">*</span>
                  </Label>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">Add variable:</span>
                    {['name', 'phone', 'service', 'amount', 'date'].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => insertVariable(v)}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-primary hover:bg-muted/80"
                      >
                        +{v}
                      </button>
                    ))}
                  </div>
                </div>
                <Textarea
                  id="tpl-body"
                  rows={4}
                  placeholder="Hello {{name}}, your subscription for {{service}} of amount {{amount}} is ready for renewal on {{date}}."
                  value={templateForm.body_text}
                  onChange={(e) => setTemplateForm({ ...templateForm, body_text: e.target.value })}
                  className="mt-1 text-xs"
                />
              </div>

              <div>
                <Label htmlFor="tpl-footer" className="text-xs">
                  Footer Text (Optional)
                </Label>
                <Input
                  id="tpl-footer"
                  placeholder="Reply STOP to unsubscribe"
                  value={templateForm.footer_text}
                  onChange={(e) => setTemplateForm({ ...templateForm, footer_text: e.target.value })}
                  className="mt-1 text-xs"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2 py-3">
              <Label htmlFor="tpl-json" className="text-xs">
                n8n Template JSON
              </Label>
              <Textarea
                id="tpl-json"
                rows={8}
                placeholder={`{
  "name": "payment_reminder",
  "category": "Utility",
  "body_text": "Hello {{name}}, your payment of {{amount}} is due on {{date}}.",
  "footer_text": "Thank you for your business"
}`}
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setImportDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleImportTemplateSubmit}
              disabled={importingTemplate}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {importingTemplate && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
              Import Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
