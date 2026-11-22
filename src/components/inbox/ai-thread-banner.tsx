"use client";

import { useState, useEffect, useCallback } from "react";
import { Sparkles, Hand, Loader2, AlertTriangle, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
import { fetchAiAccountStatus } from "@/lib/ai/account-status-cache";

interface AiThreadBannerProps {
  conversationId: string;
  /** `conversations.ai_autoreply_disabled` — bot paused on this thread. */
  disabled: boolean;
  /** `conversations.ai_handoff_summary` — note the bot left on handoff. */
  handoffSummary?: string | null;
  /** Current assignee; when a human owns the thread the bot won't run,
   *  so the "AI active" banner is suppressed. */
  assignedAgentId?: string | null;
  /** The acting agent — "Take over" assigns the thread to them. */
  currentUserId?: string | null;
  /** Called after a successful toggle so the parent can patch its local
   *  conversation state (the realtime UPDATE also arrives, but this keeps
   *  the banner instant). */
  onChange?: (patch: {
    ai_autoreply_disabled: boolean;
    assigned_agent_id?: string | null;
  }) => void;
}

/**
 * Inbox banner that surfaces + controls the AI auto-reply bot per
 * conversation:
 *   - Takeover requested → Amber alert + [Take Over] + [Dismiss]
 *   - Bot active here → "AI is replying automatically" + [Take Over]
 *   - Bot paused here → "Human Operator Active" + [Return to AI]
 */
export function AiThreadBanner({
  conversationId,
  disabled,
  handoffSummary,
  assignedAgentId,
  currentUserId,
  onChange,
}: AiThreadBannerProps) {
  const t = useTranslations("Inbox.aiBanner");
  const { accountId } = useAuth();
  const [autoReplyOn, setAutoReplyOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  // Optimistic local mirror of the pause flag so the banner flips
  // instantly on click; re-seeds whenever the thread changes.
  const [paused, setPaused] = useState(disabled);
  useEffect(() => setPaused(disabled), [conversationId, disabled]);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    fetchAiAccountStatus(accountId).then((s) => alive && setAutoReplyOn(s.autoReplyOn));
    return () => {
      alive = false;
    };
  }, [accountId]);

  const toggle = useCallback(
    async (paused: boolean) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/ai/autoreply/${conversationId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // "Take over" assigns the thread to the acting agent.
          body: JSON.stringify({ paused, assign_to_me: paused }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j?.error ?? t("updateError"));
          return;
        }
        setPaused(paused);
        onChange?.({
          ai_autoreply_disabled: paused,
          ...(paused
            ? currentUserId
              ? { assigned_agent_id: currentUserId }
              : {}
            : { assigned_agent_id: null }),
        });
        toast.success(
          paused
            ? "Human Takeover Activated (AI auto-reply paused)"
            : "Returned to AI Assistant (AI auto-reply resumed)"
        );
      } catch {
        toast.error(t("networkError"));
      } finally {
        setBusy(false);
      }
    },
    [conversationId, currentUserId, onChange, t],
  );

  const dismissRequest = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/ai/autoreply/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismiss_request: true }),
      });
      if (!res.ok) {
        toast.error("Failed to dismiss request");
        return;
      }
      onChange?.({
        ai_autoreply_disabled: false,
      });
      toast.success("Takeover request dismissed — AI Assistant remains in control");
    } catch {
      toast.error(t("networkError"));
    } finally {
      setBusy(false);
    }
  }, [conversationId, onChange, t]);

  // Account has no auto-reply → nothing to show.
  if (!autoReplyOn) return null;

  // 1. PENDING TAKEOVER REQUEST: Customer or AI requested human help, but operator hasn't taken over yet.
  if (handoffSummary && !paused && !assignedAgentId) {
    return (
      <Banner tone="amber">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
            <AlertTriangle className="h-4 w-4 animate-pulse" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-amber-300 text-xs">
              Human Takeover Requested
            </p>
            <p className="truncate text-[11px] text-amber-200/90" title={handoffSummary}>
              Customer requested human assistance. AI is currently waiting for your manual takeover.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => toggle(true)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 hover:bg-amber-600 px-3 py-1 text-xs font-semibold text-black transition-colors disabled:opacity-60 shadow-sm"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Hand className="h-3.5 w-3.5" />}
            Take Over
          </button>
          <button
            type="button"
            onClick={dismissRequest}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card hover:bg-muted px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            title="Dismiss request and keep AI in control"
          >
            Dismiss
          </button>
        </div>
      </Banner>
    );
  }

  // 2. HUMAN OPERATOR ACTIVE: Bot is paused on this thread (taken over or assigned).
  const isHumanHandled = paused || !!assignedAgentId;
  if (isHumanHandled) {
    return (
      <Banner tone="muted">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <User className="h-4 w-4 text-emerald-400 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium text-foreground">Human Operator Active</p>
            <p className="truncate text-xs text-muted-foreground">
              AI auto-reply is currently paused. Click Return to AI to restore automatic replies.
            </p>
          </div>
        </div>
        <BannerButton onClick={() => toggle(false)} busy={busy} icon={Sparkles}>
          Return to AI
        </BannerButton>
      </Banner>
    );
  }

  // 3. NORMAL AI ACTIVE: Assistant is replying automatically.
  return (
    <Banner tone="primary">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-primary animate-pulse" />
        <span className="truncate font-medium text-foreground">
          {t("activeText")}
        </span>
      </div>
      <BannerButton onClick={() => toggle(true)} busy={busy} icon={Hand}>
        {t("takeOver")}
      </BannerButton>
    </Banner>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "primary" | "muted" | "amber";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b px-3 py-2 text-xs sm:px-4",
        tone === "primary"
          ? "border-primary/20 bg-primary/5"
          : tone === "amber"
          ? "border-amber-500/30 bg-amber-500/10"
          : "border-border bg-muted/40",
      )}
    >
      {children}
    </div>
  );
}

function BannerButton({
  onClick,
  busy,
  icon: Icon,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  icon: typeof Hand | typeof Sparkles;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60 shadow-sm"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5 text-primary" />
      )}
      {children}
    </button>
  );
}
