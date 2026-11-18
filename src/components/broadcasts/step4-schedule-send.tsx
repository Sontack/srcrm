'use client';

import { useEffect, useState } from 'react';
import { countAudience, type AudienceConfig } from '@/lib/broadcast-audience';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ArrowLeft, Send, Loader2, Users, Save, CheckCircle2, AlertTriangle, Eye, Calendar, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  onSend: () => void;
  onSchedule?: (scheduledAt: string) => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  onSend,
  onSchedule,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
}: Step4Props) {
  const t = useTranslations('Broadcasts.wizard');
  const [showConfirm, setShowConfirm] = useState(false);
  const [estimatedReach, setEstimatedReach] = useState<number>(0);
  const [loadingReach, setLoadingReach] = useState(true);
  const [sendTiming, setSendTiming] = useState<'now' | 'schedule'>('now');
  const [scheduledAt, setScheduledAt] = useState<string>('');

  useEffect(() => {
    async function calculateReach() {
      setLoadingReach(true);
      try {
        setEstimatedReach((await countAudience(createClient(), audience)) ?? 0);
      } catch {
        setEstimatedReach(0);
      } finally {
        setLoadingReach(false);
      }
    }

    calculateReach();
  }, [audience]);

  const audienceLabel =
    audience.type === 'all'
      ? (t('scheduleSend.audienceAll') || 'All Contacts')
      : audience.type === 'tags'
        ? (t('scheduleSend.audienceTags') || 'Filter by Tags')
        : audience.type === 'csv'
          ? 'Upload Excel / CSV'
          : audience.type === 'manual'
            ? 'Manual Number Entry'
            : (t('scheduleSend.audienceField') || 'Custom Fields');

  const hasVariables = /\{\{[^}]+\}\}/.test(template.body_text);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('scheduleSend.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('scheduleSend.subtitle')}
        </p>
      </div>

      {/* Broadcast Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">{t('scheduleSend.broadcastName')}</label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('scheduleSend.broadcastNamePlaceholder')}
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Summary Card */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">{t('scheduleSend.summary')}</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.template')}</p>
            <p className="font-medium text-foreground">{template.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.audience')}</p>
            <p className="font-medium text-foreground">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.estimatedReach')}</p>
            <div className="flex items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : (
                <>
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <p className="font-medium text-foreground">{estimatedReach.toLocaleString()} recipients</p>
                </>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.language')}</p>
            <p className="font-medium text-foreground">{template.language ?? 'en_US'}</p>
          </div>
        </div>
      </div>

      {/* Delivery Schedule Options */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">Delivery Schedule</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setSendTiming('now')}
            className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
              sendTiming === 'now'
                ? 'border-primary bg-primary/10 text-primary font-medium'
                : 'border-border bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            <Send className="h-4 w-4 shrink-0" />
            <div>
              <div className="text-xs font-semibold text-foreground">Send Immediately</div>
              <div className="text-[11px] text-muted-foreground">Launch campaign as soon as confirmed</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setSendTiming('schedule')}
            className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
              sendTiming === 'schedule'
                ? 'border-primary bg-primary/10 text-primary font-medium'
                : 'border-border bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            <Calendar className="h-4 w-4 shrink-0" />
            <div>
              <div className="text-xs font-semibold text-foreground">Schedule for Later</div>
              <div className="text-[11px] text-muted-foreground">Pick a future date & time</div>
            </div>
          </button>
        </div>

        {sendTiming === 'schedule' && (
          <div className="pt-2 border-t border-border/60 space-y-2">
            <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-primary" />
              Select Date & Time (Local Time):
            </label>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="max-w-sm border-border bg-muted text-foreground text-xs"
            />
          </div>
        )}
      </div>

      {/* Live Message Preview */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
            <Eye className="size-4 text-primary" />
            Message Preview
          </p>
          <span className="text-[11px] text-muted-foreground font-mono">WhatsApp Envelope</span>
        </div>

        <div className="rounded-xl border border-border/80 bg-background/60 p-4 space-y-2">
          {template.header_content && (
            <p className="font-semibold text-xs text-foreground">{template.header_content}</p>
          )}
          <p className="whitespace-pre-wrap text-xs text-foreground/90 leading-relaxed font-sans">
            {template.body_text}
          </p>
          {template.footer_text && (
            <p className="text-[11px] text-muted-foreground italic">{template.footer_text}</p>
          )}
          {template.buttons && template.buttons.length > 0 && (
            <div className="pt-2 border-t border-border/40 flex flex-wrap gap-1.5">
              {template.buttons.map((btn, idx) => (
                <span
                  key={idx}
                  className="rounded-lg bg-card px-2.5 py-1 text-[11px] font-medium text-primary ring-1 ring-border/80"
                >
                  {btn.text}
                </span>
              ))}
            </div>
          )}
        </div>

        {hasVariables && audience.type === 'manual' && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-400 border border-amber-500/20">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <p>
              This template contains variables (e.g. &#123;&#123;name&#125;&#125;). For manual phone numbers without names, standard fallback values will be used.
            </p>
          </div>
        )}
      </div>

      {/* Processing overlay */}
      {isProcessing && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">{t('scheduleSend.sending')}</p>
            </div>
            <span className="text-xs font-medium text-primary">{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>

        <div className="flex items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {t('scheduleSend.saveDraft')}
            </Button>
          )}

          {sendTiming === 'schedule' ? (
            <Button
              disabled={!name.trim() || isProcessing || estimatedReach === 0 || !scheduledAt}
              onClick={() => onSchedule?.(new Date(scheduledAt).toISOString())}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Calendar className="h-4 w-4 mr-1.5" />
              Schedule Campaign
            </Button>
          ) : (
            <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
              <DialogTrigger
                render={
                  <Button
                    disabled={!name.trim() || isProcessing || estimatedReach === 0}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4 mr-1.5" />
                    {t('scheduleSend.sendNow')}
                  </Button>
                }
              />
              <DialogContent className="border-border bg-popover sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-popover-foreground">
                    Confirm Campaign Launch
                  </DialogTitle>
                  <DialogDescription className="text-muted-foreground space-y-2 pt-2">
                    <div className="rounded-lg bg-card p-3 border border-border/80 space-y-1.5 text-xs">
                      <p><strong className="text-foreground">Campaign:</strong> {name}</p>
                      <p><strong className="text-foreground">Audience:</strong> {audienceLabel}</p>
                      <p><strong className="text-foreground">Recipients:</strong> {estimatedReach.toLocaleString()} verified contacts</p>
                      <p><strong className="text-foreground">Template:</strong> {template.name}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This broadcast will be dispatched immediately through your connected WhatsApp Business API provider.
                    </p>
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2 sm:justify-end">
                  <Button
                    variant="outline"
                    onClick={() => setShowConfirm(false)}
                    className="border-border text-muted-foreground"
                  >
                    {t('cancel')}
                  </Button>
                  <Button
                    onClick={() => {
                      setShowConfirm(false);
                      onSend();
                    }}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <Send className="h-4 w-4 mr-1.5" />
                    Confirm & Launch
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>
    </div>
  );
}
