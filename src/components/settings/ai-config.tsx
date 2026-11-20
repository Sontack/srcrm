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
  Building2,
  ShieldCheck,
  Send,
  MessageSquare,
  RefreshCw,
  AlertCircle,
  HelpCircle,
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
import { SettingsPanelHead } from './settings-panel-head';
import { AiKnowledgeCard } from './ai-knowledge';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import type { AiProvider } from '@/lib/ai/types';
import type { AccountMember } from '@/types';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { useTranslations } from 'next-intl';
import { invalidateAiAccountStatus } from '@/lib/ai/account-status-cache';

const MASKED_KEY = '••••••••••••••••';
const HANDOFF_QUEUE = '__queue__';

const PROVIDER_LABEL: Record<Exclude<AiProvider, 'openai_compatible'>, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
};

const KEY_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'sk-proj-... or sk-...',
  anthropic: 'sk-ant-...',
  openai_compatible: 'your-api-key',
};

const INDUSTRY_OPTIONS = [
  'E-Commerce & Retail',
  'Healthcare & Clinic',
  'Real Estate & Property',
  'Travel, Hospitality & Tourism',
  'Consulting & Professional Services',
  'Education & Training',
  'Financial Services & Insurance',
  'Restaurant & Food Delivery',
  'Automotive & Transport',
  'IT & Software Agency',
  'Other Business',
];

export function AiConfig() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.aiConfig');

  // Main UI Mode: 'smart' (1-click auto-setup) vs 'advanced' (manual controls)
  const [setupMode, setSetupMode] = useState<'smart' | 'advanced'>('smart');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Config State
  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.openai);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
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

  // Smart Setup Form State
  const [businessName, setBusinessName] = useState('');
  const [industry, setIndustry] = useState('E-Commerce & Retail');
  const [businessHours, setBusinessHours] = useState('Mon - Sat: 9:00 AM - 8:00 PM');
  const [contactInfo, setContactInfo] = useState('');
  const [servicesAndPricing, setServicesAndPricing] = useState('');
  const [policies, setPolicies] = useState('');
  const [faqs, setFaqs] = useState('');

  // Auto-Detection State
  const [detecting, setDetecting] = useState(false);
  const [detectedProviderName, setDetectedProviderName] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [detectionSuccess, setDetectionSuccess] = useState(false);

  // Live Simulator Test State
  const [simMessage, setSimMessage] = useState('Hi! What are your services and prices?');
  const [simulating, setSimulating] = useState(false);
  const [simResponse, setSimResponse] = useState<string | null>(null);
  const [simHandoff, setSimHandoff] = useState(false);

  const loadedAccountIdRef = useRef<string | null>(null);

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
        setDetectedProviderName(
          data.provider === 'openai'
            ? 'OpenAI'
            : data.provider === 'anthropic'
            ? 'Anthropic (Claude)'
            : 'OpenAI-Compatible'
        );
      }
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
    void fetchAccountMembers().then(setMembers);
  }, [accountId, fetchConfig]);

  // Live Auto-Detection Debounce
  useEffect(() => {
    if (!keyEdited || !apiKey.trim() || apiKey === MASKED_KEY) return;
    if (apiKey.trim().length < 8) return;

    const timer = setTimeout(async () => {
      setDetecting(true);
      try {
        const res = await fetch('/api/ai/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: apiKey.trim(),
            baseUrl: baseUrl.trim() || undefined,
          }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          setProvider(data.provider);
          setDetectedProviderName(data.providerName);
          setModel(data.model);
          if (Array.isArray(data.availableModels)) {
            setAvailableModels(data.availableModels);
          }
          if (data.baseUrl) {
            setBaseUrl(data.baseUrl);
          }
          setDetectionSuccess(true);
          toast.success(`Detected ${data.providerName}! Selected model: ${data.model}`);
        } else {
          setDetectionSuccess(false);
        }
      } catch {
        setDetectionSuccess(false);
      } finally {
        setDetecting(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [apiKey, keyEdited, baseUrl]);

  const handleProviderChange = (next: AiProvider) => {
    setProvider(next);
    const isDefaultModel =
      model === AI_PROVIDER_DEFAULT_MODEL.openai ||
      model === AI_PROVIDER_DEFAULT_MODEL.anthropic ||
      model === AI_PROVIDER_DEFAULT_MODEL.openai_compatible ||
      model.trim() === '';
    if (isDefaultModel) {
      setModel(next === 'openai_compatible' ? '' : AI_PROVIDER_DEFAULT_MODEL[next]);
    }
  };

  const keyPayload = () => (keyEdited ? apiKey.trim() : undefined);
  const embeddingsKeyPayload = () =>
    embeddingsKeyEdited ? embeddingsKey.trim() || null : undefined;

  // Test Connection
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

  // Smart 1-Click Auto-Configuration & Knowledge Ingestion
  const handleSmartSetup = async () => {
    if (!configured && !keyEdited && !hasStoredKey) {
      toast.error('Please enter your AI API key');
      return;
    }
    if (!businessName.trim() && !configured) {
      toast.error('Please enter your Business / Company Name');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/ai/smart-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: keyPayload(),
          provider,
          model: model.trim() || undefined,
          baseUrl: provider === 'openai_compatible' ? baseUrl.trim() : undefined,
          businessInfo: {
            businessName: businessName.trim() || 'Our Business',
            industry,
            businessHours: businessHours.trim() || undefined,
            contactInfo: contactInfo.trim() || undefined,
            servicesAndPricing: servicesAndPricing.trim() || undefined,
            policies: policies.trim() || undefined,
            faqs: faqs.trim() || undefined,
          },
          autoReplyEnabled,
          maxPerConversation,
          handoffAgentId: handoffAgentId || null,
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        invalidateAiAccountStatus();
        toast.success('Smart AI Agent configured and activated successfully!');
        if (data.knowledgeDocsCreated > 0) {
          toast.info(`Created ${data.knowledgeDocsCreated} Knowledge Base sections for your business`);
        }
        await fetchConfig();
      } else {
        toast.error(data.error ?? 'Failed to complete Smart Setup');
      }
    } catch {
      toast.error('Network error during Smart Setup');
    } finally {
      setSaving(false);
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
        toast.success(t('saveSuccess'));
        await fetchConfig();
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
    if (!confirm('Are you sure you want to remove the AI configuration? This will disable AI auto-replies.')) {
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
                <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/30 text-emerald-400 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse" />
                  Active
                </Badge>
              ) : configured ? (
                <Badge variant="outline" className="bg-amber-500/10 border-amber-500/30 text-amber-400 text-xs">
                  Configured (Paused)
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-muted text-muted-foreground text-xs">
                  Not Configured
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automated 24/7 intelligent WhatsApp responses grounded in your business knowledge, pricing, and FAQs.
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
            <span className={`text-xs font-semibold ${autoReplyEnabled ? 'text-emerald-400' : 'text-muted-foreground'}`}>
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
            Smart 1-Click Setup (Recommended)
          </TabsTrigger>
          <TabsTrigger value="advanced" className="gap-2">
            <Sliders className="w-4 h-4" />
            Advanced Settings
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: SMART 1-CLICK SETUP */}
        <TabsContent value="smart" className="space-y-6 mt-4">
          {/* Step 1: Automatic AI Key & Model Detection */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Step 1: AI Provider &amp; API Key
                </CardTitle>
                {detectionSuccess && (
                  <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/30 text-emerald-400 text-xs gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Verified: {detectedProviderName || provider}
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs">
                Paste your OpenAI, Anthropic, Groq, or Gemini key. The system automatically detects your provider, validates the key, and selects the best model.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="smart-ai-key" className="text-xs font-semibold">
                  API Key *
                </Label>
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
                        if (!keyEdited && hasStoredKey) {
                          setApiKey('');
                          setKeyEdited(true);
                        }
                      }}
                      placeholder="sk-... (OpenAI) or sk-ant-... (Anthropic) or gsk_... (Groq)"
                      disabled={disabled}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((s) => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  <Button
                    variant="outline"
                    onClick={handleTest}
                    disabled={disabled || testing || detecting || (!keyEdited && !hasStoredKey)}
                  >
                    {testing || detecting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Test AI
                  </Button>
                </div>
              </div>

              {/* Detected Model & Provider Details Pill */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-1">
                  <div className="text-[11px] uppercase font-bold text-muted-foreground">Auto-Detected Provider</div>
                  <div className="text-sm font-semibold flex items-center gap-1.5 text-foreground">
                    <span className="w-2 h-2 rounded-full bg-primary" />
                    {detectedProviderName || (provider === 'openai' ? 'OpenAI' : provider === 'anthropic' ? 'Anthropic' : 'OpenAI-Compatible')}
                  </div>
                </div>

                <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-1">
                  <div className="text-[11px] uppercase font-bold text-muted-foreground">Selected Model</div>
                  {availableModels.length > 0 ? (
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

          {/* Step 2: Business Profile & Knowledge Ingestion */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />
                Step 2: Business Profile &amp; Knowledge Base Ingestion
              </CardTitle>
              <CardDescription className="text-xs">
                Provide your business details, services, prices, and FAQs. Our AI engine automatically structures this into your Knowledge Base so answers are always 100% accurate.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="biz-name" className="text-xs font-semibold">
                    Business / Company Name *
                  </Label>
                  <Input
                    id="biz-name"
                    placeholder="e.g. Apex Travel Agency or Glow Dental Clinic"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    disabled={disabled}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="biz-industry" className="text-xs font-semibold">
                    Industry / Category
                  </Label>
                  <select
                    id="biz-industry"
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    disabled={disabled}
                  >
                    {INDUSTRY_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="biz-hours" className="text-xs font-semibold">
                    Business Hours &amp; Working Days
                  </Label>
                  <Input
                    id="biz-hours"
                    placeholder="e.g. Mon-Sat: 9:00 AM - 8:00 PM IST (Closed Sundays)"
                    value={businessHours}
                    onChange={(e) => setBusinessHours(e.target.value)}
                    disabled={disabled}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="biz-contact" className="text-xs font-semibold">
                    Support Contact Details
                  </Label>
                  <Input
                    id="biz-contact"
                    placeholder="e.g. Phone: +91 9876543210, Email: support@apex.com, Location: Mumbai"
                    value={contactInfo}
                    onChange={(e) => setContactInfo(e.target.value)}
                    disabled={disabled}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="biz-services" className="text-xs font-semibold">
                  Official Services &amp; Pricing Catalog (Verified Reference)
                </Label>
                <Textarea
                  id="biz-services"
                  placeholder="Enter services, products, and exact prices. Example:&#10;• Dubai 5-Day Holiday Package: ₹45,000 per person&#10;• Goa Weekend Getaway: ₹12,500 per couple&#10;• Visa Assistance: ₹3,500 per applicant"
                  value={servicesAndPricing}
                  onChange={(e) => setServicesAndPricing(e.target.value)}
                  rows={4}
                  disabled={disabled}
                />
                <p className="text-[11px] text-muted-foreground">
                  The AI will strictly quote these prices and will never invent or guess unlisted rates.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="biz-policies" className="text-xs font-semibold">
                    Policies, Terms &amp; Refund Rules
                  </Label>
                  <Textarea
                    id="biz-policies"
                    placeholder="e.g. Cancellations made 48h prior receive a 90% refund. Rescheduling is complimentary up to 24h before."
                    value={policies}
                    onChange={(e) => setPolicies(e.target.value)}
                    rows={3}
                    disabled={disabled}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="biz-faqs" className="text-xs font-semibold">
                    Common Customer FAQs
                  </Label>
                  <Textarea
                    id="biz-faqs"
                    placeholder="e.g. Q: Do you provide EMI options? A: Yes, 0% EMI available on credit cards.&#10;Q: Can I book online? A: Yes via WhatsApp or website."
                    value={faqs}
                    onChange={(e) => setFaqs(e.target.value)}
                    rows={3}
                    disabled={disabled}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Step 3: WhatsApp Automation & Live Simulator */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Step 3: WhatsApp Automation &amp; Safety Controls
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
                    When active, incoming WhatsApp messages will receive instant, multilingual replies tailored to your business.
                  </div>
                </div>
                <Switch
                  checked={autoReplyEnabled}
                  onCheckedChange={setAutoReplyEnabled}
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

              {/* Main Submit Button */}
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  Clicking Activate will test your key, encrypt your credentials, generate the smart prompt, and sync the Knowledge Base.
                </div>
                <Button
                  onClick={handleSmartSetup}
                  disabled={disabled}
                  className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-6"
                >
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Configuring AI Agent...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Auto-Configure &amp; Activate AI Agent
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: ADVANCED CONFIGURATION (MANUAL CONTROLS) */}
        <TabsContent value="advanced" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sliders className="h-4 w-4 text-primary" /> {t('providerAndKey')}
              </CardTitle>
              <CardDescription>{t('encryptionNotice')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('provider')}</Label>
                  <Select
                    value={provider}
                    onValueChange={(v) => handleProviderChange(v as AiProvider)}
                    disabled={disabled}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">{PROVIDER_LABEL.openai}</SelectItem>
                      <SelectItem value="anthropic">{PROVIDER_LABEL.anthropic}</SelectItem>
                      <SelectItem value="openai_compatible">{t('providerOpenAiCompatible')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai-model-manual">{t('model')}</Label>
                  <Input
                    id="ai-model-manual"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={AI_PROVIDER_DEFAULT_MODEL[provider]}
                    disabled={disabled}
                  />
                </div>

                {provider === 'openai_compatible' && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="ai-base-url-manual">{t('baseUrl')}</Label>
                    <Input
                      id="ai-base-url-manual"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="https://api.example.com/v1"
                      disabled={disabled}
                      autoComplete="off"
                    />
                    <p className="text-xs text-muted-foreground">{t('baseUrlHint')}</p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-key-manual">{t('apiKey')}</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="ai-key-manual"
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setKeyEdited(true);
                      }}
                      onFocus={() => {
                        if (!keyEdited && hasStoredKey) {
                          setApiKey('');
                          setKeyEdited(true);
                        }
                      }}
                      placeholder={KEY_PLACEHOLDER[provider]}
                      disabled={disabled}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button variant="outline" onClick={handleTest} disabled={disabled || testing}>
                    {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    {t('testKey')}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-embeddings-key-manual">
                  {t('embeddingsKey')}{' '}
                  <span className="font-normal text-muted-foreground">{t('optionalSemanticSearch')}</span>
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
                  rows={6}
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
