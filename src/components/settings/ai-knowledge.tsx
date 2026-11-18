'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Plus,
  Trash2,
  Pencil,
  RefreshCw,
  BookOpen,
  FileSpreadsheet,
  Upload,
  Layers,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslations } from 'next-intl';
import { parseSpreadsheetToKnowledge } from '@/lib/ai/excel-knowledge-parser';

export type KnowledgeCategory =
  | 'all'
  | 'faq'
  | 'price_list'
  | 'service'
  | 'document'
  | 'rule'
  | 'timing'
  | 'custom'
  | 'general';

interface DocSummary {
  id: string;
  title: string;
  category?: string;
  metadata?: Record<string, unknown>;
  updated_at: string;
}

const CATEGORY_CONFIG: Record<
  string,
  { label: string; color: string; desc: string }
> = {
  all: { label: 'All Knowledge', color: 'border-border text-foreground', desc: 'All entries' },
  price_list: { label: 'Prices & Services', color: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400', desc: 'Pricing and fee charts' },
  faq: { label: 'FAQs & Q&A', color: 'border-blue-500/30 bg-blue-500/10 text-blue-400', desc: 'Common questions' },
  service: { label: 'Service Info', color: 'border-purple-500/30 bg-purple-500/10 text-purple-400', desc: 'Detailed service descriptions' },
  document: { label: 'Required Documents', color: 'border-amber-500/30 bg-amber-500/10 text-amber-400', desc: 'Document checklists' },
  rule: { label: 'Business Rules', color: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400', desc: 'Policies and restrictions' },
  timing: { label: 'Timings & Slots', color: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-400', desc: 'Working hours and appointments' },
  custom: { label: 'Custom Info', color: 'border-muted-foreground/30 bg-muted/30 text-muted-foreground', desc: 'Other custom details' },
  general: { label: 'General', color: 'border-border text-muted-foreground', desc: 'General knowledge' },
};

export function AiKnowledgeCard({
  accountId,
  canEdit,
  hasEmbeddingsKey,
}: {
  accountId: string | null;
  canEdit: boolean;
  hasEmbeddingsKey: boolean;
}) {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<KnowledgeCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Dialog State
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>('general');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  // Excel Upload State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingExcel, setUploadingExcel] = useState(false);

  const loadedAccountIdRef = useRef<string | null>(null);
  const t = useTranslations('Settings.aiKnowledge');

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/knowledge');
      const data = await res.json();
      if (res.ok) setDocs(data.documents ?? []);
      else toast.error(data.error ?? t('loadFailed'));
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchDocs();
  }, [accountId, fetchDocs]);

  const openNew = (cat: string = 'general') => {
    setEditingId(null);
    setTitle('');
    setCategory(cat === 'all' ? 'general' : cat);
    setContent('');
    setDialogOpen(true);
  };

  const openEdit = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('openFailed'));
        return;
      }
      setEditingId(id);
      setTitle(data.title ?? '');
      setCategory(data.category ?? 'general');
      setContent(data.content ?? '');
      setDialogOpen(true);
    } catch {
      toast.error(t('openFailed'));
    }
  };

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error('Title and content are required');
      return;
    }
    setSaving(true);
    try {
      const isNew = !editingId;
      const res = await fetch(
        isNew ? '/api/ai/knowledge' : `/api/ai/knowledge/${editingId}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            category,
            content: content.trim(),
          }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        if (data.warning) toast.warning(data.warning);
        else toast.success(isNew ? 'Knowledge document added' : 'Knowledge document updated');
        setDialogOpen(false);
        await fetchDocs();
      } else {
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleSpreadsheetUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingExcel(true);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseSpreadsheetToKnowledge(buffer, file.name);

      // Pre-fill the creation dialog with the parsed knowledge
      setTitle(parsed.title);
      setCategory('price_list');
      setContent(parsed.markdownContent);
      setEditingId(null);
      setDialogOpen(true);

      toast.success(
        `Parsed ${parsed.rowCount} rows from ${file.name}. Review and click Save to index.`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to parse file';
      toast.error(`Spreadsheet error: ${msg}`);
    } finally {
      setUploadingExcel(false);
      if (e.target) e.target.value = '';
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Are you sure you want to delete this knowledge document?')) return;
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setDocs((d) => d.filter((x) => x.id !== id));
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    }
  };

  const reindex = async () => {
    setReindexing(true);
    try {
      const res = await fetch('/api/ai/knowledge/reindex', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Successfully reindexed ${data.reindexed} knowledge documents.`);
      } else {
        toast.error(data.error ?? t('reindexFailed'));
      }
    } catch {
      toast.error(t('reindexFailed'));
    } finally {
      setReindexing(false);
    }
  };

  // Filtered docs
  const filteredDocs = docs.filter((doc) => {
    const matchesTab = activeTab === 'all' || doc.category === activeTab;
    const matchesSearch =
      !searchQuery || doc.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  return (
    <Card className="border-border/80 bg-card">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 ring-1 ring-purple-500/20">
              <BookOpen className="size-5" />
            </div>
            <div>
              <CardTitle className="text-lg">AI Knowledge Base & Price Lists</CardTitle>
              <CardDescription>
                Provide FAQs, pricing sheets, document requirements, and business rules so the AI gives accurate answers.
              </CardDescription>
            </div>
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={reindex}
                disabled={reindexing || docs.length === 0}
                className="gap-1.5 text-xs border-border"
              >
                <RefreshCw className={reindexing ? 'size-3.5 animate-spin' : 'size-3.5'} />
                Reindex
              </Button>

              {/* Excel Upload Button */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingExcel}
                className="gap-1.5 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
              >
                {uploadingExcel ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <FileSpreadsheet className="size-3.5" />
                )}
                Upload Excel / CSV
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleSpreadsheetUpload}
                className="hidden"
              />

              {/* New Document Button */}
              <Button
                type="button"
                size="sm"
                onClick={() => openNew(activeTab)}
                className="gap-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="size-3.5" />
                Add Entry
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Category Filter Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 pb-3">
          <div className="flex flex-wrap gap-1">
            {(
              [
                'all',
                'price_list',
                'faq',
                'document',
                'service',
                'rule',
                'timing',
              ] as KnowledgeCategory[]
            ).map((cat) => {
              const cfg = CATEGORY_CONFIG[cat];
              const count =
                cat === 'all'
                  ? docs.length
                  : docs.filter((d) => d.category === cat).length;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveTab(cat)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                    activeTab === cat
                      ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  }`}
                >
                  <span>{cfg.label}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative w-48">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search knowledge..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        {/* Document List */}
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin text-primary" /> Loading knowledge entries...
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 p-8 text-center">
            <BookOpen className="mx-auto size-8 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-medium text-foreground">No knowledge entries found</p>
            <p className="text-xs text-muted-foreground">
              Add FAQs, instructions, or upload an Excel/CSV price list to power your AI customer bot.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60 rounded-xl border border-border/80 overflow-hidden bg-background/50">
            {filteredDocs.map((doc) => {
              const catKey = doc.category || 'general';
              const catCfg = CATEGORY_CONFIG[catKey] || CATEGORY_CONFIG.general;
              return (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-3.5 transition-colors hover:bg-card/60"
                >
                  <div className="space-y-1 min-w-0 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {doc.title}
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-2 py-0.2 font-medium ${catCfg.color}`}
                      >
                        {catCfg.label}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Updated {new Date(doc.updated_at).toLocaleDateString()} at{' '}
                      {new Date(doc.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(doc.id)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(doc.id)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Edit / Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl border-border bg-popover text-popover-foreground">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Edit Knowledge Document' : 'Add Knowledge Document'}
            </DialogTitle>
            <DialogDescription>
              Provide questions, pricing details, or instructions. The AI will cite this knowledge when answering customers.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Label htmlFor="kb-title" className="text-xs">
                  Document Title <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="kb-title"
                  placeholder="e.g. Identity Services & Price List"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 text-xs"
                />
              </div>

              <div>
                <Label htmlFor="kb-cat" className="text-xs">
                  Category
                </Label>
                <select
                  id="kb-cat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="price_list">Prices & Services</option>
                  <option value="faq">FAQs & Q&A</option>
                  <option value="document">Required Documents</option>
                  <option value="service">Service Information</option>
                  <option value="rule">Business Rules</option>
                  <option value="timing">Timings & Appointments</option>
                  <option value="custom">Custom Info</option>
                  <option value="general">General</option>
                </select>
              </div>
            </div>

            <div>
              <Label htmlFor="kb-content" className="text-xs">
                Content (Markdown supported) <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="kb-content"
                rows={12}
                placeholder="Write FAQs, service prices, document requirements, or paste markdown tables..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="mt-1 font-mono text-xs"
              />
              <span className="text-[10px] text-muted-foreground">
                Tip: When detailing prices or documents, use clear headers (e.g. Service: PAN Card, Price: ₹150, Documents: Aadhaar Card).
              </span>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
              Save & Index
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
