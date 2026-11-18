'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Webhook,
  Play,
  RotateCw,
  Maximize2,
  Minimize2,
  ExternalLink,
  Plus,
  Trash2,
  Download,
  Upload,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  FolderOpen,
  FileCode,
  Settings,
  Sparkles,
  Search,
  Filter,
  Activity,
  Layers,
  ChevronRight,
  ShieldAlert,
  Server,
  Zap,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import type { N8nWorkflow, N8nExecution } from '@/lib/n8n/client';
import type { PrebuiltTemplate } from '@/app/api/n8n/workspace/templates/route';

interface WorkspaceStatus {
  configured: boolean;
  connected: boolean;
  instanceUrl: string;
  editorUrl: string;
  status: string;
  version?: string;
  error?: string;
  workflowMappings?: Record<string, string>;
  events?: string[];
}

export function N8nWorkspace() {
  const [activeTab, setActiveTab] = useState('editor');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [status, setStatus] = useState<WorkspaceStatus>({
    configured: false,
    connected: false,
    instanceUrl: '',
    editorUrl: '',
    status: 'disconnected',
  });

  // Workflows & Executions
  const [workflows, setWorkflows] = useState<N8nWorkflow[]>([]);
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);
  const [executions, setExecutions] = useState<N8nExecution[]>([]);
  const [loadingExecutions, setLoadingExecutions] = useState(false);
  const [templates, setTemplates] = useState<PrebuiltTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Selected workflow in editor canvas
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('');
  const [iframeKey, setIframeKey] = useState<number>(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Modals
  const [importJsonOpen, setImportJsonOpen] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [importingJson, setImportingJson] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<PrebuiltTemplate | null>(null);

  // Settings tab form state
  const [inputInstanceUrl, setInputInstanceUrl] = useState('');
  const [inputApiKey, setInputApiKey] = useState('');
  const [inputWebhookUrl, setInputWebhookUrl] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  // Event Mappings state
  const [crmMappings, setCrmMappings] = useState<Record<string, string>>({});
  const [activeEvents, setActiveEvents] = useState<string[]>([
    'message.received',
    'contact.created',
    'broadcast.completed',
    'conversation.handoff',
  ]);
  const [savingMappings, setSavingMappings] = useState(false);

  // Load Status
  const fetchStatus = useCallback(async () => {
    try {
      setStatusLoading(true);
      const res = await fetch('/api/n8n/workspace/status');
      if (res.ok) {
        const data: WorkspaceStatus = await res.json();
        setStatus(data);
        if (data.instanceUrl) {
          setInputInstanceUrl(data.instanceUrl);
        }
        if (data.workflowMappings) {
          setCrmMappings(data.workflowMappings);
        }
        if (data.events) {
          setActiveEvents(data.events);
        }
      }
    } catch (e) {
      console.error('Failed to load n8n status:', e);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  // Load Workflows
  const fetchWorkflows = useCallback(async () => {
    try {
      setLoadingWorkflows(true);
      const res = await fetch('/api/n8n/workspace/workflows?limit=100');
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data.workflows || []);
      }
    } catch (e) {
      console.error('Failed to load workflows:', e);
    } finally {
      setLoadingWorkflows(false);
    }
  }, []);

  // Load Executions
  const fetchExecutions = useCallback(async () => {
    try {
      setLoadingExecutions(true);
      const res = await fetch('/api/n8n/workspace/executions?limit=50');
      if (res.ok) {
        const data = await res.json();
        setExecutions(data.executions || []);
      }
    } catch (e) {
      console.error('Failed to load executions:', e);
    } finally {
      setLoadingExecutions(false);
    }
  }, []);

  // Load Templates
  const fetchTemplates = useCallback(async () => {
    try {
      setLoadingTemplates(true);
      const res = await fetch('/api/n8n/workspace/templates');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch (e) {
      console.error('Failed to load templates:', e);
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchWorkflows();
    fetchTemplates();
  }, [fetchStatus, fetchWorkflows, fetchTemplates]);

  useEffect(() => {
    if (activeTab === 'executions') {
      fetchExecutions();
    } else if (activeTab === 'workflows') {
      fetchWorkflows();
    }
  }, [activeTab, fetchExecutions, fetchWorkflows]);

  // Handle Fullscreen Key ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // Toggle Workflow Active Status
  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      const res = await fetch(`/api/n8n/workspace/workflows/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !currentActive }),
      });
      if (res.ok) {
        toast.success(`Workflow ${!currentActive ? 'activated' : 'deactivated'} in n8n`);
        setWorkflows((prev) =>
          prev.map((w) => (w.id === id ? { ...w, active: !currentActive } : w))
        );
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to update workflow state');
      }
    } catch (e) {
      toast.error('Network error toggling workflow');
    }
  };

  // Delete Workflow
  const handleDeleteWorkflow = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete workflow "${name}" from n8n?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/n8n/workspace/workflows/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success(`Deleted workflow "${name}"`);
        setWorkflows((prev) => prev.filter((w) => w.id !== id));
        if (selectedWorkflowId === id) {
          setSelectedWorkflowId('');
        }
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to delete workflow');
      }
    } catch (e) {
      toast.error('Network error deleting workflow');
    }
  };

  // Export Workflow as JSON
  const handleExportWorkflow = async (w: N8nWorkflow) => {
    try {
      const res = await fetch(`/api/n8n/workspace/workflows/${encodeURIComponent(w.id)}`);
      const data = await res.json();
      const exportData = data.workflow || w;
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${w.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-n8n.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${w.name}`);
    } catch (e) {
      toast.error('Failed to export workflow');
    }
  };

  // Import Template into n8n
  const handleImportTemplate = async (templateId: string) => {
    try {
      toast.loading('Importing workflow into n8n instance...', { id: 'import-template' });
      const res = await fetch('/api/n8n/workspace/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Workflow imported into n8n!', { id: 'import-template' });
        await fetchWorkflows();
        if (data.workflow?.id) {
          setSelectedWorkflowId(data.workflow.id);
          setActiveTab('editor');
          setIframeKey((k) => k + 1);
        }
      } else {
        toast.error(data.error || 'Failed to import template', { id: 'import-template' });
      }
    } catch (e) {
      toast.error('Error importing template', { id: 'import-template' });
    }
  };

  // Import Raw Workflow JSON
  const handleImportJson = async () => {
    if (!importJsonText.trim()) {
      toast.error('Please enter workflow JSON');
      return;
    }
    try {
      setImportingJson(true);
      const res = await fetch('/api/n8n/workspace/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowJson: importJsonText.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Custom workflow created in n8n!');
        setImportJsonOpen(false);
        setImportJsonText('');
        await fetchWorkflows();
        if (data.workflow?.id) {
          setSelectedWorkflowId(data.workflow.id);
          setActiveTab('editor');
          setIframeKey((k) => k + 1);
        }
      } else {
        toast.error(data.error || 'Import failed');
      }
    } catch (e) {
      toast.error('Error importing workflow JSON');
    } finally {
      setImportingJson(false);
    }
  };

  // Save Settings
  const handleSaveSettings = async () => {
    if (!inputInstanceUrl.trim()) {
      toast.error('Instance URL is required');
      return;
    }
    try {
      setSavingSettings(true);
      const res = await fetch('/api/n8n/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_url: inputInstanceUrl.trim(),
          api_key: inputApiKey.trim() || undefined,
          webhook_url: inputWebhookUrl.trim() || undefined,
        }),
      });
      if (res.ok) {
        toast.success('n8n connection settings saved!');
        await fetchStatus();
        await fetchWorkflows();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to save settings');
      }
    } catch (e) {
      toast.error('Network error saving settings');
    } finally {
      setSavingSettings(false);
    }
  };

  // Test Connection
  const handleTestConnection = async () => {
    try {
      setTestingConnection(true);
      const res = await fetch('/api/n8n/workspace/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_url: inputInstanceUrl.trim() || status.instanceUrl,
          api_key: inputApiKey.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`Connected to n8n successfully! (${data.version || 'OK'})`);
        await fetchStatus();
      } else {
        toast.error(data.error || 'Connection failed. Verify instance URL and API key.');
      }
    } catch (e) {
      toast.error('Failed to reach server for test');
    } finally {
      setTestingConnection(false);
    }
  };

  // Save Mappings
  const handleSaveMappings = async () => {
    try {
      setSavingMappings(true);
      const res = await fetch('/api/n8n/workspace/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowMappings: crmMappings,
          activeEvents,
        }),
      });
      if (res.ok) {
        toast.success('CRM event trigger mappings updated!');
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to save mappings');
      }
    } catch (e) {
      toast.error('Network error saving mappings');
    } finally {
      setSavingMappings(false);
    }
  };

  // Retry execution
  const handleRetryExecution = async (execId: string) => {
    try {
      toast.loading('Retrying execution...', { id: 'retry-exec' });
      const res = await fetch('/api/n8n/workspace/executions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry', executionId: execId }),
      });
      if (res.ok) {
        toast.success('Execution retry triggered!', { id: 'retry-exec' });
        fetchExecutions();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to retry', { id: 'retry-exec' });
      }
    } catch (e) {
      toast.error('Error retrying execution', { id: 'retry-exec' });
    }
  };

  // Stop execution
  const handleStopExecution = async (execId: string) => {
    try {
      toast.loading('Stopping execution...', { id: 'stop-exec' });
      const res = await fetch('/api/n8n/workspace/executions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop', executionId: execId }),
      });
      if (res.ok) {
        toast.success('Execution stopped!', { id: 'stop-exec' });
        fetchExecutions();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to stop', { id: 'stop-exec' });
      }
    } catch (e) {
      toast.error('Error stopping execution', { id: 'stop-exec' });
    }
  };

  // Compute editor embed target
  const editorBase = status.editorUrl || status.instanceUrl || 'http://localhost:5678';
  const iframeTargetUrl = selectedWorkflowId
    ? `${editorBase}/workflow/${selectedWorkflowId}`
    : `${editorBase}/workflow/new`;

  // Filtered workflows
  const filteredWorkflows = workflows.filter((w) => {
    const matchesSearch =
      w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (w.tags && w.tags.some((t) => t.name.toLowerCase().includes(searchQuery.toLowerCase())));
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && w.active) ||
      (statusFilter === 'inactive' && !w.active);
    return matchesSearch && matchesStatus;
  });

  // Filtered templates
  const filteredTemplates = templates.filter((t) => {
    const matchesCat = selectedCategory === 'all' || t.category === selectedCategory;
    const matchesSearch =
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  // Stats
  const activeCount = workflows.filter((w) => w.active).length;
  const inactiveCount = workflows.length - activeCount;

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 flex flex-col bg-background text-foreground'
          : 'flex flex-col flex-1 min-h-[calc(100vh-4rem)] p-4 sm:p-6 space-y-6 max-w-full overflow-x-hidden'
      }
    >
      {/* Top Banner / Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 text-primary">
            <Webhook className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">n8n Automation Workspace</h1>
              <Badge variant="outline" className="text-xs bg-primary/10 border-primary/30 text-primary">
                Live Engine
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Build, run, and orchestrate enterprise WhatsApp automations directly inside your CRM.
            </p>
          </div>
        </div>

        {/* Status Pill & Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {status.connected ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Connected: {status.version || 'n8n Active'}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              {status.instanceUrl ? 'Instance Offline / Check Key' : 'No Instance Connected'}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchStatus();
              fetchWorkflows();
              if (activeTab === 'editor') setIframeKey((k) => k + 1);
            }}
            title="Refresh connection & workflows"
          >
            <RotateCw className="w-4 h-4 mr-1.5" />
            Sync
          </Button>

          {status.instanceUrl && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(iframeTargetUrl, '_blank')}
              title="Open n8n in separate browser window"
            >
              <ExternalLink className="w-4 h-4 mr-1.5" />
              New Window
            </Button>
          )}

          <Button
            variant={isFullscreen ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Exit Full Screen (Esc)' : 'Full Screen Canvas'}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-4 h-4 mr-1.5" />
                Exit Full Screen
              </>
            ) : (
              <>
                <Maximize2 className="w-4 h-4 mr-1.5" />
                Full Screen
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <TabsList className="bg-card border border-border p-1">
            <TabsTrigger value="editor" className="gap-2">
              <Layers className="w-4 h-4" />
              Workflow Canvas
            </TabsTrigger>
            <TabsTrigger value="overview" className="gap-2">
              <Activity className="w-4 h-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="workflows" className="gap-2">
              <FolderOpen className="w-4 h-4" />
              Workflows ({workflows.length})
            </TabsTrigger>
            <TabsTrigger value="executions" className="gap-2">
              <Clock className="w-4 h-4" />
              Executions
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-2">
              <Sparkles className="w-4 h-4" />
              Templates ({templates.length})
            </TabsTrigger>
            <TabsTrigger value="mappings" className="gap-2">
              <Zap className="w-4 h-4" />
              CRM Triggers
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2">
              <Settings className="w-4 h-4" />
              Settings
            </TabsTrigger>
          </TabsList>

          {activeTab === 'editor' && (
            <div className="flex items-center gap-2">
              <select
                className="bg-card border border-border text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary max-w-[220px] truncate"
                value={selectedWorkflowId}
                onChange={(e) => {
                  setSelectedWorkflowId(e.target.value);
                  setIframeKey((k) => k + 1);
                }}
              >
                <option value="">+ New Blank Canvas</option>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} {w.active ? '● (Active)' : ''}
                  </option>
                ))}
              </select>

              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  setSelectedWorkflowId('');
                  setIframeKey((k) => k + 1);
                }}
              >
                <Plus className="w-4 h-4 mr-1" />
                New Workflow
              </Button>
            </div>
          )}
        </div>

        {/* TAB 1: LIVE CANVAS (EMBEDDED N8N ENGINE) */}
        <TabsContent value="editor" className="flex-1 flex flex-col min-h-[600px] mt-0">
          {!status.instanceUrl ? (
            <Card className="flex-1 flex flex-col items-center justify-center p-8 text-center border-dashed border-2">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center mb-4">
                <Webhook className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-2">Connect Your n8n Instance</h3>
              <p className="text-sm text-muted-foreground max-w-md mb-6">
                To run the live n8n workflow canvas inside WhatsApp CRM, configure your self-hosted n8n instance URL or
                start the included Docker stack.
              </p>
              <div className="flex flex-wrap gap-3 justify-center">
                <Button onClick={() => setActiveTab('settings')}>
                  <Settings className="w-4 h-4 mr-2" />
                  Configure Connection
                </Button>
                <Button variant="outline" onClick={() => setActiveTab('templates')}>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Browse Prebuilt Workflows
                </Button>
              </div>
            </Card>
          ) : (
            <div className="relative flex-1 flex flex-col rounded-lg border border-border bg-card overflow-hidden shadow-inner min-h-[650px]">
              {/* Iframe for actual n8n canvas */}
              <iframe
                key={iframeKey}
                ref={iframeRef}
                src={iframeTargetUrl}
                title="n8n Live Workflow Canvas"
                className="w-full h-full flex-1 min-h-[650px] border-0"
                allow="clipboard-read; clipboard-write; fullscreen"
                loading="eager"
              />

              {/* Bottom status bar */}
              <div className="flex items-center justify-between px-3 py-1.5 bg-muted/60 border-t border-border text-xs text-muted-foreground">
                <div className="flex items-center gap-2 truncate">
                  <span className="font-semibold text-foreground">Target URL:</span>
                  <span className="truncate font-mono">{iframeTargetUrl}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span>If iframe is blank, verify <code>N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS</code> &amp; CSP headers</span>
                  <button
                    onClick={() => setIframeKey((k) => k + 1)}
                    className="hover:text-primary transition-colors underline font-medium"
                  >
                    Reload Canvas
                  </button>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* TAB 2: OVERVIEW & METRICS */}
        <TabsContent value="overview" className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase font-semibold">Total Workflows</CardDescription>
                <CardTitle className="text-3xl font-bold">{workflows.length}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                In connected n8n database
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase font-semibold">Active Automations</CardDescription>
                <CardTitle className="text-3xl font-bold text-emerald-400">{activeCount}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Listening for triggers &amp; webhooks
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase font-semibold">Inactive Workflows</CardDescription>
                <CardTitle className="text-3xl font-bold text-muted-foreground">{inactiveCount}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Drafts or paused automations
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase font-semibold">Engine Health</CardDescription>
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  {status.connected ? (
                    <span className="text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-5 h-5" /> Operational
                    </span>
                  ) : (
                    <span className="text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle className="w-5 h-5" /> Disconnected
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {status.version || 'Check connection settings'}
              </CardContent>
            </Card>
          </div>

          {/* Quick Launch Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="hover:border-primary/50 transition-all cursor-pointer" onClick={() => setActiveTab('editor')}>
              <CardHeader>
                <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-2">
                  <Play className="w-5 h-5" />
                </div>
                <CardTitle className="text-base">Open Workflow Canvas</CardTitle>
                <CardDescription className="text-xs">
                  Launch the visual drag-and-drop editor with all available nodes, triggers, and integrations.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="hover:border-primary/50 transition-all cursor-pointer" onClick={() => setActiveTab('templates')}>
              <CardHeader>
                <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-2">
                  <Sparkles className="w-5 h-5" />
                </div>
                <CardTitle className="text-base">Prebuilt CRM Workflows</CardTitle>
                <CardDescription className="text-xs">
                  Import ready-made WhatsApp AI customer support, Google Sheet sync, and lead routing templates.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="hover:border-primary/50 transition-all cursor-pointer" onClick={() => setActiveTab('mappings')}>
              <CardHeader>
                <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-2">
                  <Zap className="w-5 h-5" />
                </div>
                <CardTitle className="text-base">WhatsApp CRM Triggers</CardTitle>
                <CardDescription className="text-xs">
                  Connect incoming WhatsApp messages, contacts, and broadcasts directly to specific workflows.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>

          {/* Recent Workflows */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base">Active n8n Workflows</CardTitle>
                <CardDescription className="text-xs">Workflows currently running in your engine</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setActiveTab('workflows')}>
                View All
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </CardHeader>
            <CardContent>
              {workflows.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  No workflows found. Create one in the Canvas or import a Template!
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {workflows.slice(0, 5).map((w) => (
                    <div key={w.id} className="py-3 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full ${w.active ? 'bg-emerald-400' : 'bg-muted-foreground'}`} />
                        <div>
                          <div className="font-medium text-sm">{w.name}</div>
                          <div className="text-xs text-muted-foreground">
                            Updated {new Date(w.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedWorkflowId(w.id);
                            setActiveTab('editor');
                          }}
                        >
                          Open in Canvas
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: WORKFLOWS MANAGEMENT */}
        <TabsContent value="workflows" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search workflows by name or tag..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 text-sm"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
                className="bg-card border border-border text-sm rounded-md px-3 py-2"
              >
                <option value="all">All Status</option>
                <option value="active">Active Only</option>
                <option value="inactive">Inactive Only</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setImportJsonOpen(true)}>
                <Upload className="w-4 h-4 mr-1.5" />
                Import JSON
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setSelectedWorkflowId('');
                  setActiveTab('editor');
                }}
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Create Workflow
              </Button>
            </div>
          </div>

          {/* Workflows List */}
          {loadingWorkflows ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              Loading workflows from n8n instance...
            </div>
          ) : filteredWorkflows.length === 0 ? (
            <Card className="p-8 text-center">
              <FolderOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold text-base mb-1">No Workflows Found</h3>
              <p className="text-xs text-muted-foreground mb-4">
                {searchQuery ? 'Try adjusting your search query' : 'Get started by creating your first workflow'}
              </p>
              <Button
                size="sm"
                onClick={() => {
                  setSelectedWorkflowId('');
                  setActiveTab('editor');
                }}
              >
                Create Workflow
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredWorkflows.map((w) => (
                <Card key={w.id} className="flex flex-col justify-between hover:border-primary/40 transition-colors">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <CardTitle className="text-base font-semibold leading-snug line-clamp-1">
                          {w.name}
                        </CardTitle>
                        <CardDescription className="text-xs mt-1">
                          Updated {new Date(w.updatedAt).toLocaleDateString()}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground font-medium">
                          {w.active ? 'Active' : 'Off'}
                        </span>
                        <Switch
                          checked={w.active}
                          onCheckedChange={() => handleToggleActive(w.id, w.active)}
                        />
                      </div>
                    </div>

                    {w.tags && w.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {w.tags.map((t) => (
                          <Badge key={t.id || t.name} variant="secondary" className="text-[10px] px-1.5 py-0">
                            {t.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardHeader>

                  <CardFooter className="pt-2 border-t border-border flex items-center justify-between text-xs">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-8 text-primary"
                      onClick={() => {
                        setSelectedWorkflowId(w.id);
                        setActiveTab('editor');
                      }}
                    >
                      Open in Canvas
                    </Button>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="Export JSON"
                        onClick={() => handleExportWorkflow(w)}
                      >
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title="Delete Workflow"
                        onClick={() => handleDeleteWorkflow(w.id, w.name)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* TAB 4: EXECUTIONS HISTORY */}
        <TabsContent value="executions" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Workflow Executions</h2>
              <p className="text-xs text-muted-foreground">Real-time execution telemetry and logs from n8n</p>
            </div>
            <Button variant="outline" size="sm" onClick={fetchExecutions}>
              <RotateCw className="w-4 h-4 mr-1.5" />
              Refresh Logs
            </Button>
          </div>

          {loadingExecutions ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              Loading execution logs...
            </div>
          ) : executions.length === 0 ? (
            <Card className="p-8 text-center">
              <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold text-base mb-1">No Executions Recorded Yet</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Execute a workflow manually or trigger a WhatsApp event to see executions here.
              </p>
            </Card>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden bg-card">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-xs text-muted-foreground uppercase border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Workflow</th>
                    <th className="px-4 py-3">Started</th>
                    <th className="px-4 py-3">Mode</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {executions.map((e) => {
                    const statusBadge =
                      e.status === 'success' ? (
                        <Badge variant="outline" className="text-emerald-400 bg-emerald-500/10 border-emerald-500/20 text-xs">
                          Success
                        </Badge>
                      ) : e.status === 'error' || e.status === 'crashed' ? (
                        <Badge variant="outline" className="text-destructive bg-destructive/10 border-destructive/20 text-xs">
                          Failed
                        </Badge>
                      ) : e.status === 'running' ? (
                        <Badge variant="outline" className="text-primary bg-primary/10 border-primary/20 text-xs animate-pulse">
                          Running
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          {e.status}
                        </Badge>
                      );

                    return (
                      <tr key={e.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3">{statusBadge}</td>
                        <td className="px-4 py-3 font-medium">
                          {e.workflowName || e.workflowId || 'Execution #' + e.id}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(e.startedAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-xs capitalize text-muted-foreground">{e.mode}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {e.status === 'error' && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => handleRetryExecution(e.id)}
                              >
                                Retry
                              </Button>
                            )}
                            {e.status === 'running' && (
                              <Button
                                variant="destructive"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => handleStopExecution(e.id)}
                              >
                                Stop
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* TAB 5: TEMPLATES LIBRARY */}
        <TabsContent value="templates" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Prebuilt WhatsApp CRM Workflows</h2>
              <p className="text-xs text-muted-foreground">
                One-click deployment of production-ready automations into your connected n8n instance.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setImportJsonOpen(true)}>
                <Upload className="w-4 h-4 mr-1.5" />
                Upload JSON Template
              </Button>
            </div>
          </div>

          {/* Categories */}
          <div className="flex flex-wrap gap-2 pt-1">
            {['all', 'AI & Chatbots', 'Leads & CRM', 'E-Commerce & Orders', 'Notifications & Alerts', 'Surveys & Feedback'].map((cat) => (
              <Button
                key={cat}
                variant={selectedCategory === cat ? 'default' : 'outline'}
                size="sm"
                className="text-xs h-8 capitalize"
                onClick={() => setSelectedCategory(cat)}
              >
                {cat === 'all' ? 'All Categories' : cat}
              </Button>
            ))}
          </div>

          {/* Templates Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
            {filteredTemplates.map((tpl) => (
              <Card key={tpl.id} className="flex flex-col justify-between hover:border-primary/50 transition-all">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20">
                      {tpl.category}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground font-medium">
                      {tpl.nodesCount} Nodes
                    </span>
                  </div>
                  <CardTitle className="text-base font-bold leading-snug">{tpl.name}</CardTitle>
                  <CardDescription className="text-xs mt-2 line-clamp-3">
                    {tpl.description}
                  </CardDescription>

                  <div className="flex flex-wrap gap-1 mt-3">
                    {tpl.tags.map((t) => (
                      <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </CardHeader>

                <CardFooter className="pt-3 border-t border-border flex items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs flex-1"
                    onClick={() => setPreviewTemplate(tpl)}
                  >
                    Preview
                  </Button>
                  <Button
                    size="sm"
                    className="text-xs flex-1"
                    onClick={() => handleImportTemplate(tpl.id)}
                  >
                    Import to n8n
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* TAB 6: CRM EVENT TRIGGERS (MAPPINGS) */}
        <TabsContent value="mappings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">CRM Event to n8n Webhook Mappings</CardTitle>
              <CardDescription className="text-xs">
                Automatically fire n8n workflows whenever specific events happen inside WhatsApp CRM.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {[
                {
                  id: 'message.received',
                  title: 'New WhatsApp Inbound Message',
                  desc: 'Fires when any customer sends a text, audio, image, or document message.',
                },
                {
                  id: 'contact.created',
                  title: 'New Contact Created / Imported',
                  desc: 'Fires when a new contact is added via chat, manual entry, or CSV/Excel import.',
                },
                {
                  id: 'broadcast.completed',
                  title: 'Broadcast Campaign Finished',
                  desc: 'Fires when a mass WhatsApp broadcast campaign completes delivery.',
                },
                {
                  id: 'conversation.handoff',
                  title: 'Human Agent Handover Requested',
                  desc: 'Fires when customer asks for a live operator or AI escalates the chat.',
                },
              ].map((evt) => {
                const isEnabled = activeEvents.includes(evt.id);
                return (
                  <div key={evt.id} className="p-4 rounded-lg border border-border bg-card/60 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-sm">{evt.title}</div>
                        <div className="text-xs text-muted-foreground">{evt.desc}</div>
                      </div>
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setActiveEvents((prev) => [...prev, evt.id]);
                          } else {
                            setActiveEvents((prev) => prev.filter((e) => e !== evt.id));
                          }
                        }}
                      />
                    </div>

                    {isEnabled && (
                      <div className="pt-2">
                        <label className="text-xs text-muted-foreground mb-1 block">
                          Dedicated n8n Webhook URL (leave empty to use default webhook URL):
                        </label>
                        <Input
                          placeholder="e.g. http://localhost:5678/webhook/my-whatsapp-trigger"
                          value={crmMappings[evt.id] || ''}
                          onChange={(e) =>
                            setCrmMappings((prev) => ({ ...prev, [evt.id]: e.target.value }))
                          }
                          className="text-xs font-mono"
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              <Button onClick={handleSaveMappings} disabled={savingMappings}>
                {savingMappings ? 'Saving Mappings...' : 'Save Trigger Mappings'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 7: SETTINGS & SELF-HOST INFRASTRUCTURE */}
        <TabsContent value="settings" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Instance Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Server className="w-5 h-5 text-primary" />
                  n8n Instance Connection
                </CardTitle>
                <CardDescription className="text-xs">
                  Connect your self-hosted or cloud n8n server.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">n8n Instance URL *</label>
                  <Input
                    placeholder="e.g. http://localhost:5678 or https://n8n.yourdomain.com"
                    value={inputInstanceUrl}
                    onChange={(e) => setInputInstanceUrl(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    The root URL where your n8n web app is accessible.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">n8n API Key (Recommended)</label>
                  <Input
                    type="password"
                    placeholder={status.configured ? '••••••••••••••••' : 'Enter n8n API Key'}
                    value={inputApiKey}
                    onChange={(e) => setInputApiKey(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Generated inside n8n via Settings &gt; n8n API &gt; Create API Key.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Default Webhook URL (Optional)</label>
                  <Input
                    placeholder="e.g. http://localhost:5678/webhook/crm-events"
                    value={inputWebhookUrl}
                    onChange={(e) => setInputWebhookUrl(e.target.value)}
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button onClick={handleSaveSettings} disabled={savingSettings}>
                    {savingSettings ? 'Saving...' : 'Save Configuration'}
                  </Button>
                  <Button variant="outline" onClick={handleTestConnection} disabled={testingConnection}>
                    {testingConnection ? 'Testing...' : 'Test Connection'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Embedding Guidelines & Environment Variables */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-amber-400" />
                  Embedding Security Configuration
                </CardTitle>
                <CardDescription className="text-xs">
                  To allow n8n to load inside the CRM iframe without browser CSP blocks:
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="p-3 rounded bg-muted/60 font-mono space-y-1">
                  <div className="text-foreground font-semibold"># Required n8n Environment Variables</div>
                  <div>N8N_EDITOR_BASE_URL=http://localhost:5678</div>
                  <div>N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true</div>
                  <div>WEBHOOK_URL=http://localhost:5678/</div>
                </div>

                <p className="text-muted-foreground">
                  If your browser blocks the canvas with an &quot;X-Frame-Options&quot; or &quot;Content-Security-Policy&quot; error,
                  ensure your reverse proxy (Nginx, Caddy, or Traefik) sends:
                </p>

                <div className="p-3 rounded bg-muted/60 font-mono text-[11px]">
                  Content-Security-Policy: frame-ancestors &apos;self&apos; http://localhost:3000 https://*.yourcrm.com;
                </div>

                <div className="pt-2">
                  <p className="font-medium text-foreground mb-1">Docker Compose Included:</p>
                  <p className="text-muted-foreground">
                    A pre-configured <code>docker-compose.n8n.yml</code> and startup scripts (<code>scripts/start-n8n.bat</code>)
                    are included in this repository.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* IMPORT JSON DIALOG */}
      <Dialog open={importJsonOpen} onOpenChange={setImportJsonOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Import Workflow JSON into n8n</DialogTitle>
            <DialogDescription>
              Paste workflow JSON exported from another n8n instance or downloaded from n8n community templates.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Textarea
              placeholder='{ "name": "My Workflow", "nodes": [...], "connections": {...} }'
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
              rows={12}
              className="font-mono text-xs"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportJsonOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleImportJson} disabled={importingJson}>
              {importingJson ? 'Importing...' : 'Create in n8n'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PREVIEW TEMPLATE DIALOG */}
      {previewTemplate && (
        <Dialog open={!!previewTemplate} onOpenChange={() => setPreviewTemplate(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-xs bg-primary/10 text-primary">
                  {previewTemplate.category}
                </Badge>
                <span className="text-xs text-muted-foreground">{previewTemplate.nodesCount} Nodes</span>
              </div>
              <DialogTitle>{previewTemplate.name}</DialogTitle>
              <DialogDescription>{previewTemplate.description}</DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="text-xs font-semibold text-foreground">Included Nodes:</div>
              <div className="border border-border rounded p-3 bg-muted/40 divide-y divide-border/60 text-xs font-mono">
                {previewTemplate.workflow.nodes.map((n: any, idx: number) => (
                  <div key={idx} className="py-1.5 flex items-center justify-between">
                    <span className="font-medium text-foreground">{n.name}</span>
                    <span className="text-muted-foreground">{n.type}</span>
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setPreviewTemplate(null)}>
                Close
              </Button>
              <Button
                onClick={() => {
                  const id = previewTemplate.id;
                  setPreviewTemplate(null);
                  handleImportTemplate(id);
                }}
              >
                Import to n8n Instance
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
