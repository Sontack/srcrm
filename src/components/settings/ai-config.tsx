'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Sparkles,
  CheckCircle2,
  Trash2,
  Eye,
  EyeOff,
  Zap,
  Sliders,
  Bot,
  ShieldCheck,
  Send,
  MessageSquare,
  RefreshCw,
  Plus,
  Key,
  Star,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AiKnowledgeCard } from './ai-knowledge';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import type { AiProvider } from '@/lib/ai/types';
import type { AccountMember } from '@/types';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { useTranslations } from 'next-intl';
import { invalidateAiAccountStatus } from '@/lib/ai/account-status-cache';
import type { AiKeyItem } from '@/lib/ai/key-manager';

const MASKED_KEY = '••••••••••••••••';
const HANDOFF_QUEUE = '__queue__';

export function AiConfig() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.aiConfig');

  // Main UI Mode: 'smart' (AI Keys & Automation) vs 'advanced' (System Prompt & Manual)
  const [setupMode, setSetupMode] = useState<'smart' | 'advanced'>('smart');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Config State
  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai_compatible');
  const [model, setModel] = useState('models/gemini-2.5-flash-lite');
  const [baseUrl, setBaseUrl] = useState('https://generativelanguage.googleapis.com/v1beta/openai');
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [revealedPrimaryPlain, setRevealedPrimaryPlain] = useState<string | null>(null);
  const [revealingPrimary, setRevealingPrimary] = useState(false);

  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [embeddingsKey, setEmbeddingsKey] = useState('');
  const [embeddingsKeyEdited, setEmbeddingsKeyEdited] = useState(false);
  const [hasStoredEmbeddingsKey, setHasStoredEmbeddingsKey] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [maxPerConversation, setMaxPerConversation] = useState(3);
  const [handoffAgentId, setHandoffAgentId] = useState('');
  const [members, setMembers] = useState<AccountMember[]>([]);

  // Multiple API Keys State
  const [aiKeys, setAiKeys] = useState<AiKeyItem[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [revealingKeyId, setRevealingKeyId] = useState<string | null>(null);
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null);

  // Add / Edit Key Form State
  const [showAddKeyForm, setShowAddKeyForm] = useState(false);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyProvider, setNewKeyProvider] = useState<AiProvider>('openai_compatible');
  const [newKeyModel, setNewKeyModel] = useState('');
  const [newKeyBaseUrl, setNewKeyBaseUrl] = useState('');
  const [newKeyApiKey, setNewKeyApiKey] = useState('');
  const [newKeyShowPlain, setNewKeyShowPlain] = useState(false);
  const [newKeyIsPrimary, setNewKeyIsPrimary] = useState(false);
  const [savingNewKey, setSavingNewKey] = useState(false);

  // Auto-Detection State
  const [detecting, setDetecting] = useState(false);
  const [detectedProviderName, setDetectedProviderName] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsList, setModelsList] = useState<
    { id: string; name: string; description?: string; recommended?: boolean }[]
  >([]);
  const [detectionSuccess, setDetectionSuccess] = useState(false);

  // Live Simulator Test State
  const [simMessage, setSimMessage] = useState('Hi! What are your services and prices?');
  const [simulating, setSimulating] = useState(false);
  const [simResponse, setSimResponse] = useState<string | null>(null);
  const [simHandoff, setSimHandoff] = useState(false);

  const loadedAccountIdRef = useRef<string | null>(null);

  // Fetch Multiple Keys List
  const fetchKeys = useCallback(async () => {
    setLoadingKeys(true);
    try {
      const res = await fetch('/api/ai/keys');
      const data = await res.json();
      if (res.ok && Array.isArray(data.keys)) {
        setAiKeys(data.keys);
      }
    } catch {
      // ignore
    } finally {
      setLoadingKeys(false);
    }
  }, []);

  // Trigger Provider & Model Auto-Detection
  const runAutoDetect = useCallback(
    async (explicitKey?: string, explicitBaseUrl?: string) => {
      const keyToDetect =
        explicitKey !== undefined ? explicitKey : keyEdited ? apiKey.trim() : '';
      const urlToDetect =
        explicitBaseUrl !== undefined ? explicitBaseUrl : baseUrl.trim();

      setDetecting(true);
      try {
        const res = await fetch('/api/ai/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: keyToDetect || undefined,
            baseUrl: urlToDetect || undefined,
          }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          setProvider(data.provider);
          setDetectedProviderName(data.providerName);
          if (data.model) {
            setModel(data.model);
          }
          if (Array.isArray(data.availableModels)) {
            setAvailableModels(data.availableModels);
          }
          if (Array.isArray(data.modelsList)) {
            setModelsList(data.modelsList);
          }
          if (data.baseUrl) {
            setBaseUrl(data.baseUrl);
          }
          setDetectionSuccess(true);
          if (explicitKey !== undefined || !keyEdited) {
            toast.success(`Connected to ${data.providerName}! Selected model: ${data.model}`);
          }
        } else {
          setDetectionSuccess(false);
          if (explicitKey !== undefined) {
            toast.error(data.error ?? 'Could not detect AI provider');
          }
        }
      } catch {
        setDetectionSuccess(false);
        if (explicitKey !== undefined) {
          toast.error('Network error during AI detection');
        }
      } finally {
        setDetecting(false);
      }
    },
    [apiKey, keyEdited, baseUrl]
  );

  // Fetch Existing Config
  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('loadFailed'));
        return;
      }
      if (data.configured) {
        setConfigured(true);
        setProvider(data.provider);
        setModel(data.model);
        setBaseUrl(data.base_url ?? '');
        setSystemPrompt(data.system_prompt ?? '');
        setIsActive(data.is_active);
        setAutoReplyEnabled(data.auto_reply_enabled);
        setMaxPerConversation(data.auto_reply_max_per_conversation ?? 3);
        setHandoffAgentId(data.handoff_agent_id ?? '');
        setHasStoredKey(Boolean(data.has_key));
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
        setHasStoredEmbeddingsKey(Boolean(data.has_embeddings_key));
        setEmbeddingsKey(data.has_embeddings_key ? MASKED_KEY : '');
        setEmbeddingsKeyEdited(false);
        setDetectionSuccess(true);

        const bUrl = data.base_url || '';
        const detectedName =
          data.provider === 'openai'
            ? 'OpenAI'
            : data.provider === 'anthropic'
            ? 'Anthropic (Claude)'
            : bUrl.includes('generativelanguage.googleapis.com')
            ? 'Google Gemini'
            : bUrl.includes('openrouter.ai')
            ? 'OpenRouter'
            : bUrl.includes('groq.com')
            ? 'Groq'
            : bUrl.includes('nvidia.com')
            ? 'NVIDIA NIM'
            : bUrl.includes('deepseek.com')
            ? 'DeepSeek'
            : 'OpenAI-Compatible';

        setDetectedProviderName(detectedName);

        // Preload detected models using stored key
        if (data.has_key) {
          void runAutoDetect('', bUrl);
        }
      }
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, runAutoDetect]);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
    void fetchKeys();
    void fetchAccountMembers().then(setMembers);
  }, [accountId, fetchConfig, fetchKeys]);

  // Live Auto-Detection Debounce
  useEffect(() => {
    if (!keyEdited || !apiKey.trim() || apiKey === MASKED_KEY) return;
    if (apiKey.trim().length < 8) return;

    const timer = setTimeout(() => {
      void runAutoDetect(apiKey.trim(), baseUrl.trim());
    }, 600);

    return () => clearTimeout(timer);
  }, [apiKey, keyEdited, baseUrl, runAutoDetect]);

  const keyPayload = () => (keyEdited ? apiKey.trim() : undefined);
  const embeddingsKeyPayload = () =>
    embeddingsKeyEdited ? embeddingsKey.trim() || null : undefined;

  // Toggle Eye Show/Hide for Primary Key (fetches decrypted key securely if stored)
  const handleToggleShowPrimaryKey = async () => {
    if (showKey) {
      setShowKey(false);
      return;
    }

    if (keyEdited) {
      setShowKey(true);
      return;
    }

    if (!hasStoredKey) {
      setShowKey(true);
      return;
    }

    // Key is stored in database — reveal via authenticated admin endpoint
    if (revealedPrimaryPlain) {
      setApiKey(revealedPrimaryPlain);
      setShowKey(true);
      return;
    }

    setRevealingPrimary(true);
    try {
      const primaryKeyObj = aiKeys.find((k) => k.isPrimary);
      const targetId = primaryKeyObj ? primaryKeyObj.id : 'primary-config-key';
      const res = await fetch(`/api/ai/keys/${targetId}/reveal`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.apiKey) {
        setRevealedPrimaryPlain(data.apiKey);
        setApiKey(data.apiKey);
        setShowKey(true);
        toast.success('API Key verified & visible');
      } else {
        toast.error(data.error ?? 'Failed to reveal stored key');
      }
    } catch {
      toast.error('Network error verifying API key');
    } finally {
      setRevealingPrimary(false);
    }
  };

  // Toggle Eye Show/Hide for Any Saved Key Item
  const handleToggleRevealKey = async (keyItem: AiKeyItem) => {
    if (revealedKeys[keyItem.id]) {
      setRevealedKeys((prev) => {
        const next = { ...prev };
        delete next[keyItem.id];
        return next;
      });
      return;
    }

    setRevealingKeyId(keyItem.id);
    try {
      const res = await fetch(`/api/ai/keys/${keyItem.id}/reveal`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.apiKey) {
        setRevealedKeys((prev) => ({ ...prev, [keyItem.id]: data.apiKey }));
        toast.success(`Key "${keyItem.label}" revealed`);
      } else {
        toast.error(data.error ?? 'Failed to reveal API key');
      }
    } catch {
      toast.error('Network error revealing API key');
    } finally {
      setRevealingKeyId(null);
    }
  };

  // Test Connection for Any Saved Key
  const handleTestKeyItem = async (keyItem: AiKeyItem) => {
    setTestingKeyId(keyItem.id);
    try {
      const res = await fetch(`/api/ai/keys/${keyItem.id}/test`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Verified: ${data.message || 'Key connected successfully!'}`);
        await fetchKeys();
      } else {
        toast.error(data.error ?? 'Connection test failed');
      }
    } catch {
      toast.error('Network error during connection test');
    } finally {
      setTestingKeyId(null);
    }
  };

  // Set Key as Primary
  const handleSetPrimaryKey = async (keyItem: AiKeyItem) => {
    try {
      const res = await fetch(`/api/ai/keys/${keyItem.id}/primary`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast.success(`"${keyItem.label}" is now your Primary API Key`);
        invalidateAiAccountStatus();
        await fetchKeys();
        await fetchConfig();
      } else {
        toast.error(data.error ?? 'Failed to set primary key');
      }
    } catch {
      toast.error('Network error setting primary key');
    }
  };

  // Toggle Key Enabled / Disabled
  const handleToggleKeyActive = async (keyItem: AiKeyItem, isActiveVal: boolean) => {
    try {
      const res = await fetch(`/api/ai/keys/${keyItem.id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: isActiveVal }),
      });
      if (res.ok) {
        toast.success(`Key "${keyItem.label}" ${isActiveVal ? 'Enabled' : 'Disabled'}`);
        await fetchKeys();
      } else {
        toast.error('Failed to update key status');
      }
    } catch {
      toast.error('Network error updating key');
    }
  };

  // Delete Key
  const handleDeleteKey = async (keyItem: AiKeyItem) => {
    if (!confirm(`Are you sure you want to delete "${keyItem.label}"?`)) return;

    try {
      const res = await fetch(`/api/ai/keys/${keyItem.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(`Key "${keyItem.label}" deleted`);
        invalidateAiAccountStatus();
        await fetchKeys();
        await fetchConfig();
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Failed to delete key');
      }
    } catch {
      toast.error('Network error deleting key');
    }
  };

  // Add / Save New Key
  const handleSaveNewKey = async () => {
    if (!newKeyApiKey.trim()) {
      toast.error('Please enter the API key');
      return;
    }
    if (!newKeyModel.trim()) {
      toast.error('Please select or specify a model');
      return;
    }
    if (newKeyProvider === 'openai_compatible' && !newKeyBaseUrl.trim()) {
      toast.error('Base URL is required for OpenAI-compatible providers');
      return;
    }

    setSavingNewKey(true);
    try {
      const res = await fetch('/api/ai/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newKeyLabel.trim() || undefined,
          provider: newKeyProvider,
          model: newKeyModel.trim(),
          base_url: newKeyProvider === 'openai_compatible' ? newKeyBaseUrl.trim() : null,
          api_key: newKeyApiKey.trim(),
          is_primary: newKeyIsPrimary,
          is_active: true,
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(`API Key "${data.key.label}" verified and saved successfully!`);
        setShowAddKeyForm(false);
        setNewKeyApiKey('');
        setNewKeyLabel('');
        setNewKeyModel('');
        setNewKeyBaseUrl('');
        setNewKeyIsPrimary(false);
        invalidateAiAccountStatus();
        await fetchKeys();
        await fetchConfig();
      } else {
        toast.error(data.error ?? 'Failed to save API key. Please check the key and provider.');
      }
    } catch {
      toast.error('Network error saving API key');
    } finally {
      setSavingNewKey(false);
    }
  };

  // Test Connection for Main Key
  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          base_url: provider === 'openai_compatible' ? baseUrl.trim() : null,
          api_key: keyPayload(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`AI Connection Verified! Successfully pinged ${model}`);
        setDetectionSuccess(true);
      } else {
        toast.error(data.error ?? t('testRejected'));
        setDetectionSuccess(false);
      }
    } catch {
      toast.error(t('testNetworkError'));
      setDetectionSuccess(false);
    } finally {
      setTesting(false);
    }
  };

  // Manual Advanced Save
  const handleManualSave = async () => {
    if (!model.trim()) {
      toast.error(t('missingModel'));
      return;
    }
    if (provider === 'openai_compatible' && !baseUrl.trim()) {
      toast.error(t('missingBaseUrl'));
      return;
    }
    if (!configured && !keyEdited) {
      toast.error(t('missingApiKey'));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          base_url: provider === 'openai_compatible' ? baseUrl.trim() : null,
          api_key: keyPayload(),
          embeddings_api_key: embeddingsKeyPayload(),
          system_prompt: systemPrompt.trim() || null,
          is_active: isActive,
          auto_reply_enabled: autoReplyEnabled,
          auto_reply_max_per_conversation: maxPerConversation,
          handoffAgentId: handoffAgentId || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        invalidateAiAccountStatus();
        toast.success('AI configuration and Primary Key saved securely!');
        await fetchConfig();
        await fetchKeys();
      } else {
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // Fast Toggle for Auto-Reply
  const handleToggleAutoReply = async (enabled: boolean) => {
    setAutoReplyEnabled(enabled);
    if (!configured) return;

    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          is_active: true,
          auto_reply_enabled: enabled,
          auto_reply_max_per_conversation: maxPerConversation,
          handoff_agent_id: handoffAgentId || null,
        }),
      });
      if (res.ok) {
        invalidateAiAccountStatus();
        setIsActive(true);
        toast.success(`WhatsApp Auto-Reply ${enabled ? 'Activated' : 'Paused'}`);
      }
    } catch {
      toast.error('Failed to update Auto-Reply status');
    }
  };

  // Live Simulator Test
  const handleSimulateChat = async () => {
    if (!simMessage.trim()) return;
    setSimulating(true);
    setSimResponse(null);
    setSimHandoff(false);

    try {
      const res = await fetch('/api/ai/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: simMessage.trim() }],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSimResponse(data.reply || '(No text returned)');
        setSimHandoff(Boolean(data.handoff));
      } else {
        setSimResponse(`Error: ${data.error || 'Failed to simulate AI response'}`);
      }
    } catch {
      setSimResponse('Error: Network timeout or unreachable AI service');
    } finally {
      setSimulating(false);
    }
  };

  // Remove Config
  const handleRemove = async () => {
    if (
      !confirm(
        'Are you sure you want to remove the AI configuration? This will disable AI auto-replies.'
      )
    ) {
      return;
    }
    setRemoving(true);
    try {
      const res = await fetch('/api/ai/config', { method: 'DELETE' });
      if (res.ok) {
        invalidateAiAccountStatus();
        toast.success(t('removeSuccess'));
        setConfigured(false);
        setBaseUrl('');
        setHasStoredKey(false);
        setApiKey('');
        setKeyEdited(false);
        setHasStoredEmbeddingsKey(false);
        setEmbeddingsKey('');
        setEmbeddingsKeyEdited(false);
        setIsActive(false);
        setAutoReplyEnabled(false);
        setSystemPrompt('');
        setHandoffAgentId('');
        setDetectionSuccess(false);
        await fetchKeys();
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setRemoving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading AI configuration...
      </div>
    );
  }

  const disabled = !canEdit || saving;

  return (
    <div className="space-y-6">
      {/* Header Banner & Live Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card/60 backdrop-blur shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 text-primary">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">Smart AI Customer Support Assistant</h2>
              {configured && isActive ? (
                <Badge
                  variant="outline"
                  className="bg-emerald-500/10 border-emerald-500/30 text-emerald-400 text-xs"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse" />
                  Active
                </Badge>
              ) : configured ? (
                <Badge
                  variant="outline"
                  className="bg-amber-500/10 border-amber-500/30 text-amber-400 text-xs"
                >
                  Configured (Paused)
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-muted text-muted-foreground text-xs">
                  Not Configured
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automated 24/7 intelligent WhatsApp responses with multi-key failover and knowledge retrieval.
            </p>
          </div>
        </div>

        {/* Status Pill & Fast Auto-Reply Toggle */}
        <div className="flex items-center gap-3 self-end sm:self-center">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-background">
            <span className="text-xs font-medium text-foreground">Auto-Reply:</span>
            <Switch
              checked={autoReplyEnabled}
              onCheckedChange={handleToggleAutoReply}
              disabled={disabled || !configured}
            />
            <span
              className={`text-xs font-semibold ${
                autoReplyEnabled ? 'text-emerald-400' : 'text-muted-foreground'
              }`}
            >
              {autoReplyEnabled ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>
      </div>

      {/* Mode Switcher Tabs */}
      <Tabs value={setupMode} onValueChange={(v) => setSetupMode(v as 'smart' | 'advanced')}>
        <TabsList className="bg-card border border-border p-1">
          <TabsTrigger value="smart" className="gap-2">
            <Zap className="w-4 h-4 text-primary" />
            AI Keys &amp; Automation
          </TabsTrigger>
          <TabsTrigger value="advanced" className="gap-2">
            <Sliders className="w-4 h-4" />
            System Prompt &amp; Advanced
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: AI KEYS & AUTOMATION */}
        <TabsContent value="smart" className="space-y-6 mt-4">
          {/* Card 1: Primary AI Key & Provider Auto-Detection */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Primary AI Provider &amp; API Key
                </CardTitle>
                {detectionSuccess && (
                  <Badge
                    variant="outline"
                    className="bg-emerald-500/10 border-emerald-500/30 text-emerald-400 text-xs gap-1"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Verified: {detectedProviderName || provider}
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs">
                Enter your Primary API Key. The system validates the key, detects the provider, and secures it. Use the eye icon anytime to verify your saved key.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="smart-ai-key" className="text-xs font-semibold">
                    Primary API Key *
                  </Label>
                  {hasStoredKey && !keyEdited && (
                    <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Key saved in database
                    </span>
                  )}
                </div>

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="smart-ai-key"
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setKeyEdited(true);
                      }}
                      onFocus={() => {
                        if (!keyEdited && hasStoredKey && !showKey) {
                          setApiKey('');
                          setKeyEdited(true);
                        }
                      }}
                      placeholder="Paste your Gemini, OpenAI, or Anthropic API Key"
                      disabled={disabled}
                      autoComplete="off"
                      className="pr-10 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleToggleShowPrimaryKey}
                      disabled={revealingPrimary}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground focus:outline-none"
                      title={showKey ? 'Hide API Key' : 'Show / Verify API Key'}
                      tabIndex={-1}
                    >
                      {revealingPrimary ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : showKey ? (
                        <EyeOff className="h-4 w-4 text-primary" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  <Button
                    variant="outline"
                    onClick={() => runAutoDetect()}
                    disabled={disabled || detecting || (!keyEdited && !hasStoredKey)}
                    title="Detect provider and available models"
                  >
                    {detecting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Detect
                  </Button>

                  <Button
                    variant="outline"
                    onClick={handleTest}
                    disabled={disabled || testing || detecting || (!keyEdited && !hasStoredKey)}
                  >
                    {testing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Test Key
                  </Button>

                  <Button
                    onClick={handleManualSave}
                    disabled={disabled || saving}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Check className="h-4 w-4 mr-1.5" />}
                    Save Key
                  </Button>
                </div>
              </div>

              {/* Detected Model & Provider Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-1">
                  <div className="text-[11px] uppercase font-bold text-muted-foreground">
                    Auto-Detected Provider
                  </div>
                  <div className="text-sm font-semibold flex items-center gap-1.5 text-foreground">
                    <span className="w-2 h-2 rounded-full bg-primary" />
                    {detectedProviderName ||
                      (provider === 'openai'
                        ? 'OpenAI'
                        : provider === 'anthropic'
                        ? 'Anthropic'
                        : 'OpenAI-Compatible')}
                  </div>
                </div>

                <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-1">
                  <div className="text-[11px] uppercase font-bold text-muted-foreground">
                    Selected Model
                  </div>
                  {modelsList.length > 0 ? (
                    <select
                      className="bg-transparent border-0 text-sm font-semibold text-foreground focus:outline-none w-full cursor-pointer truncate"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    >
                      {modelsList.map((m) => (
                        <option key={m.id} value={m.id} className="bg-popover text-popover-foreground">
                          {m.name || m.id}
                          {m.recommended ? ' ★ (Recommended)' : ''}
                        </option>
                      ))}
                    </select>
                  ) : availableModels.length > 0 ? (
                    <select
                      className="bg-transparent border-0 text-sm font-semibold text-foreground focus:outline-none w-full cursor-pointer truncate"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    >
                      {availableModels.map((m) => (
                        <option key={m} value={m} className="bg-popover text-popover-foreground">
                          {m}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-sm font-semibold text-foreground truncate">
                      {model || 'Auto-select on key entry'}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Multiple API Keys & Automatic Failover Management */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Key className="w-4 h-4 text-primary" />
                    Multiple API Keys &amp; Automatic Failover
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Save multiple API keys for the same AI provider. If your primary key reaches rate limits or quota, the AI automatically fails over to your backup keys with zero message loss.
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  onClick={() => setShowAddKeyForm((v) => !v)}
                  className="self-start sm:self-auto gap-1 text-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {showAddKeyForm ? 'Cancel' : 'Add Backup API Key'}
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Expandable Add New Key Form */}
              {showAddKeyForm && (
                <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-4">
                  <div className="font-semibold text-sm text-foreground flex items-center gap-2">
                    <Plus className="w-4 h-4 text-primary" /> Add New API Key (Primary or Backup)
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Key Label *</Label>
                      <Input
                        placeholder="e.g. Gemini Backup 1, OpenAI Reserve"
                        value={newKeyLabel}
                        onChange={(e) => setNewKeyLabel(e.target.value)}
                        className="text-xs"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Provider *</Label>
                      <select
                        className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm"
                        value={newKeyProvider}
                        onChange={(e) => setNewKeyProvider(e.target.value as AiProvider)}
                      >
                        <option value="openai_compatible">OpenAI-Compatible (Gemini, Groq, OpenRouter)</option>
                        <option value="openai">OpenAI (ChatGPT)</option>
                        <option value="anthropic">Anthropic (Claude)</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">API Key *</Label>
                    <div className="relative">
                      <Input
                        type={newKeyShowPlain ? 'text' : 'password'}
                        placeholder="Paste API Key here"
                        value={newKeyApiKey}
                        onChange={(e) => setNewKeyApiKey(e.target.value)}
                        className="pr-10 font-mono text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setNewKeyShowPlain((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {newKeyShowPlain ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Model Name / ID *</Label>
                      <Input
                        placeholder="e.g. models/gemini-2.5-flash-lite or gpt-4o-mini"
                        value={newKeyModel}
                        onChange={(e) => setNewKeyModel(e.target.value)}
                        className="text-xs"
                      />
                    </div>

                    {newKeyProvider === 'openai_compatible' && (
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">Base URL</Label>
                        <Input
                          placeholder="e.g. https://generativelanguage.googleapis.com/v1beta/openai"
                          value={newKeyBaseUrl}
                          onChange={(e) => setNewKeyBaseUrl(e.target.value)}
                          className="text-xs"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground">
                      <input
                        type="checkbox"
                        checked={newKeyIsPrimary}
                        onChange={(e) => setNewKeyIsPrimary(e.target.checked)}
                        className="rounded border-input text-primary focus:ring-primary"
                      />
                      Make this the Primary API Key immediately
                    </label>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowAddKeyForm(false)}
                        disabled={savingNewKey}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveNewKey}
                        disabled={savingNewKey || !newKeyApiKey.trim()}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                      >
                        {savingNewKey ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                            Verifying &amp; Saving...
                          </>
                        ) : (
                          <>
                            <Check className="w-3.5 h-3.5 mr-1.5" />
                            Validate &amp; Save Key
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Keys List */}
              {loadingKeys ? (
                <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading saved keys...
                </div>
              ) : aiKeys.length === 0 ? (
                <div className="p-6 rounded-lg border border-dashed border-border text-center space-y-2">
                  <Key className="w-6 h-6 text-muted-foreground mx-auto" />
                  <p className="text-xs text-muted-foreground">
                    Your Primary Key above is currently handling all requests. You can add backup keys anytime for automated failover.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {aiKeys.map((k, index) => {
                    const isRevealed = Boolean(revealedKeys[k.id]);
                    const isTestingThis = testingKeyId === k.id;
                    const isRevealingThis = revealingKeyId === k.id;

                    return (
                      <div
                        key={k.id}
                        className={`p-3.5 rounded-xl border transition-all ${
                          k.isPrimary
                            ? 'border-primary/40 bg-primary/[0.03] shadow-sm'
                            : 'border-border bg-card'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm text-foreground">
                                {k.label || `API Key ${index + 1}`}
                              </span>
                              {k.isPrimary ? (
                                <Badge className="bg-primary text-primary-foreground text-[10px] gap-1 px-1.5 py-0.5">
                                  <Star className="w-3 h-3 fill-current" /> Primary
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] text-muted-foreground px-1.5 py-0.5">
                                  Backup #{index}
                                </Badge>
                              )}

                              {/* Status Badge */}
                              {k.status === 'active' && (
                                <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/30 text-emerald-400 text-[10px]">
                                  Active
                                </Badge>
                              )}
                              {k.status === 'backup' && (
                                <Badge variant="outline" className="bg-blue-500/10 border-blue-500/30 text-blue-400 text-[10px]">
                                  Standby / Failover Ready
                                </Badge>
                              )}
                              {k.status === 'rate_limited' && (
                                <Badge variant="outline" className="bg-amber-500/10 border-amber-500/30 text-amber-400 text-[10px] gap-1">
                                  <AlertTriangle className="w-3 h-3" /> Rate Limited (Cooling Down)
                                </Badge>
                              )}
                              {k.status === 'invalid' && (
                                <Badge variant="outline" className="bg-rose-500/10 border-rose-500/30 text-rose-400 text-[10px]">
                                  Invalid Key
                                </Badge>
                              )}
                              {k.status === 'disabled' && (
                                <Badge variant="outline" className="bg-muted text-muted-foreground text-[10px]">
                                  Disabled
                                </Badge>
                              )}
                            </div>

                            <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono flex-wrap">
                              <span className="text-foreground font-semibold">
                                {isRevealed ? revealedKeys[k.id] : k.keyHint}
                              </span>
                              <span>•</span>
                              <span>{k.provider}</span>
                              <span>•</span>
                              <span className="text-foreground">{k.model}</span>
                            </div>

                            {/* Request Stats */}
                            <div className="text-[11px] text-muted-foreground flex items-center gap-3 pt-0.5">
                              <span>Total: {k.totalRequests} reqs</span>
                              <span>Success: {k.successfulRequests}</span>
                              {k.rateLimitErrors > 0 && (
                                <span className="text-amber-400">Rate limits: {k.rateLimitErrors}</span>
                              )}
                              {k.lastUsedAt && (
                                <span>Last used: {new Date(k.lastUsedAt).toLocaleTimeString()}</span>
                              )}
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-1.5 self-end sm:self-center">
                            {/* Eye Reveal Button */}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                              title={isRevealed ? 'Hide API Key' : 'Reveal API Key'}
                              onClick={() => handleToggleRevealKey(k)}
                              disabled={isRevealingThis}
                            >
                              {isRevealingThis ? (
                                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                              ) : isRevealed ? (
                                <EyeOff className="w-4 h-4 text-primary" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </Button>

                            {/* Test Connection */}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs gap-1"
                              onClick={() => handleTestKeyItem(k)}
                              disabled={isTestingThis}
                              title="Test API Key connection"
                            >
                              {isTestingThis ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              )}
                              Test
                            </Button>

                            {/* Set Primary Button */}
                            {!k.isPrimary && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-8 px-2 text-xs"
                                onClick={() => handleSetPrimaryKey(k)}
                                title="Promote to Primary Key"
                              >
                                Set Primary
                              </Button>
                            )}

                            {/* Enable/Disable Switch */}
                            <div className="flex items-center px-1" title={k.isActive ? 'Disable Key' : 'Enable Key'}>
                              <Switch
                                checked={k.isActive}
                                onCheckedChange={(val) => handleToggleKeyActive(k, val)}
                              />
                            </div>

                            {/* Delete Button */}
                            {aiKeys.length > 1 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                                onClick={() => handleDeleteKey(k)}
                                title="Delete key"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card 3: WhatsApp Automation & Live Simulator */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                WhatsApp Automation &amp; Safety Controls
              </CardTitle>
              <CardDescription className="text-xs">
                Fine-tuned conversational safety and real-time response simulator.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-lg border border-border bg-muted/20">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-foreground">Automatic WhatsApp Reply</div>
                  <div className="text-[11px] text-muted-foreground">
                    When active, incoming WhatsApp messages will receive instant, multilingual replies tailored to your business rules.
                  </div>
                </div>
                <Switch
                  checked={autoReplyEnabled}
                  onCheckedChange={handleToggleAutoReply}
                  disabled={disabled}
                />
              </div>

              {/* Live Simulator */}
              <div className="p-4 rounded-xl border border-border bg-card space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-primary" />
                    Test AI Customer Support Simulator
                  </div>
                  {simHandoff && (
                    <Badge variant="outline" className="text-[10px] bg-rose-500/10 border-rose-500/30 text-rose-400">
                      Human Escalation Triggered
                    </Badge>
                  )}
                </div>

                <div className="flex gap-2">
                  <Input
                    placeholder="Type a sample customer question..."
                    value={simMessage}
                    onChange={(e) => setSimMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSimulateChat()}
                    className="text-xs"
                    disabled={simulating}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleSimulateChat}
                    disabled={simulating || !simMessage.trim()}
                  >
                    {simulating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Send className="w-3.5 h-3.5 mr-1" />}
                    Simulate
                  </Button>
                </div>

                {simResponse && (
                  <div className="mt-2 p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs text-foreground space-y-1">
                    <div className="font-semibold text-primary text-[11px]">AI Simulated WhatsApp Response:</div>
                    <div className="whitespace-pre-wrap">{simResponse}</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: SYSTEM PROMPT & ADVANCED CONTROLS */}
        <TabsContent value="advanced" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('behaviour')}</CardTitle>
              <CardDescription>{t('behaviourDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ai-prompt-manual">{t('businessContext')}</Label>
                <Textarea
                  id="ai-prompt-manual"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder={t('promptPlaceholder')}
                  rows={8}
                  disabled={disabled}
                />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{t('enableAssistant')}</p>
                  <p className="text-xs text-muted-foreground">{t('enableAssistantDesc')}</p>
                </div>
                <Switch checked={isActive} onCheckedChange={setIsActive} disabled={disabled} />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{t('autoReply')}</p>
                  <p className="text-xs text-muted-foreground">{t('autoReplyDesc')}</p>
                </div>
                <Switch
                  checked={autoReplyEnabled}
                  onCheckedChange={setAutoReplyEnabled}
                  disabled={disabled || !isActive}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="ai-max-manual">{t('maxAutoReplies')}</Label>
                  <p className="text-xs text-muted-foreground">{t('maxAutoRepliesDesc')}</p>
                </div>
                <Input
                  id="ai-max-manual"
                  type="number"
                  min={1}
                  max={20}
                  value={maxPerConversation}
                  onChange={(e) =>
                    setMaxPerConversation(Math.min(20, Math.max(1, Number(e.target.value) || 1)))
                  }
                  disabled={disabled || !autoReplyEnabled}
                  className="w-20"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-handoff-manual">{t('handoffTo')}</Label>
                <p className="text-xs text-muted-foreground">{t('handoffToDesc')}</p>
                <Select
                  value={handoffAgentId || HANDOFF_QUEUE}
                  onValueChange={(v) => setHandoffAgentId(!v || v === HANDOFF_QUEUE ? '' : v)}
                  disabled={disabled || !autoReplyEnabled}
                >
                  <SelectTrigger id="ai-handoff-manual">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HANDOFF_QUEUE}>{t('handoffQueue')}</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {memberLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {provider === 'openai_compatible' && (
                <div className="space-y-2 pt-2 border-t border-border">
                  <Label htmlFor="ai-base-url-manual">{t('baseUrl')}</Label>
                  <Input
                    id="ai-base-url-manual"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://generativelanguage.googleapis.com/v1beta/openai"
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">{t('baseUrlHint')}</p>
                </div>
              )}

              <div className="space-y-2 pt-2 border-t border-border">
                <Label htmlFor="ai-embeddings-key-manual">
                  {t('embeddingsKey')}{' '}
                  <span className="font-normal text-muted-foreground">
                    {t('optionalSemanticSearch')}
                  </span>
                </Label>
                <Input
                  id="ai-embeddings-key-manual"
                  type="password"
                  value={embeddingsKey}
                  onChange={(e) => {
                    setEmbeddingsKey(e.target.value);
                    setEmbeddingsKeyEdited(true);
                  }}
                  onFocus={() => {
                    if (!embeddingsKeyEdited && hasStoredEmbeddingsKey) {
                      setEmbeddingsKey('');
                      setEmbeddingsKeyEdited(true);
                    }
                  }}
                  placeholder="sk-... (OpenAI)"
                  disabled={disabled}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  {t('embeddingsHint', {
                    sameKeyText: provider === 'openai' ? t('sameKeyText') : '',
                  })}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            {configured ? (
              <Button
                variant="ghost"
                onClick={handleRemove}
                disabled={!canEdit || removing}
                className="text-destructive hover:text-destructive"
              >
                {removing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                {t('remove')}
              </Button>
            ) : (
              <span />
            )}

            <Button onClick={handleManualSave} disabled={disabled}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* Embedded Knowledge Base Card */}
      <AiKnowledgeCard
        accountId={accountId}
        canEdit={canEdit}
        hasEmbeddingsKey={
          embeddingsKeyEdited ? embeddingsKey.trim().length > 0 : hasStoredEmbeddingsKey
        }
      />
    </div>
  );
}
