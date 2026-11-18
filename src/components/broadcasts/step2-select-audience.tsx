'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  countAudience,
  resolveAudienceContacts,
  type AudienceConfig,
  type CustomFieldFilter,
  type CustomFieldOperator,
} from '@/lib/broadcast-audience';
import { parseManualPhoneNumbers } from '@/lib/phone-smart-normalize';
import { parseExcelOrCsv, generateErrorReportCsv } from '@/lib/excel-helper';
import { CustomField, Tag, Contact } from '@/types';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Users,
  Tags,
  Filter,
  Upload,
  FileSpreadsheet,
  FileText,
  Loader2,
  ArrowRight,
  ArrowLeft,
  X,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Copy,
  Download,
  Eye,
  EyeOff,
  UserCheck,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

export type AudienceType = 'all' | 'tags' | 'custom_field' | 'csv' | 'manual';

interface Step2Props {
  audience: AudienceConfig;
  onUpdate: (audience: AudienceConfig) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step2SelectAudience({
  audience,
  onUpdate,
  onNext,
  onBack,
}: Step2Props) {
  const t = useTranslations('Broadcasts.wizard');

  const OPERATOR_OPTIONS = useMemo<{ value: CustomFieldOperator; label: string }[]>(() => [
    { value: 'is', label: t('selectAudience.operatorIs') || 'Equals' },
    { value: 'is_not', label: t('selectAudience.operatorIsNot') || 'Not Equals' },
    { value: 'contains', label: t('selectAudience.operatorContains') || 'Contains' },
    { value: 'gt', label: 'Greater Than (>)' },
    { value: 'lt', label: 'Less Than (<)' },
  ], [t]);

  const audienceOptions = useMemo<{
    type: AudienceType;
    label: string;
    description: string;
    icon: typeof Users;
  }[]>(() => [
    {
      type: 'all',
      label: t('selectAudience.method.all') || 'All Contacts',
      description: 'Send to all eligible contacts in your database',
      icon: Users,
    },
    {
      type: 'tags',
      label: t('selectAudience.method.tags') || 'Filter by Tags',
      description: 'Target contacts associated with specific tags',
      icon: Tags,
    },
    {
      type: 'custom_field',
      label: t('selectAudience.method.customField') || 'Custom Fields',
      description: 'Filter contacts by database custom attributes',
      icon: Filter,
    },
    {
      type: 'csv',
      label: 'Upload Excel / CSV',
      description: 'Import from .xlsx, .xls, or .csv spreadsheet',
      icon: FileSpreadsheet,
    },
    {
      type: 'manual',
      label: 'Manual Number Entry',
      description: 'Copy and paste mobile numbers directly',
      icon: Copy,
    },
  ], [t]);

  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);

  // Excel / CSV state
  const [pickedFileName, setPickedFileName] = useState<string | null>(null);
  const [excelErrorReport, setExcelErrorReport] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manual entry state
  const [manualText, setManualText] = useState('');
  const [manualStats, setManualStats] = useState<{
    total: number;
    validCount: number;
    invalidCount: number;
    duplicatesCount: number;
    invalidSamples: Array<{ raw: string; error: string }>;
  }>({ total: 0, validCount: 0, invalidCount: 0, duplicatesCount: 0, invalidSamples: [] });

  // Preview contacts state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewList, setPreviewList] = useState<Array<{ name?: string; phone: string; tags?: string[] }>>([]);

  // Tag match mode
  const tagMatchMode = audience.tagMatchMode ?? 'any';

  // Custom field conditions
  const conditions: CustomFieldFilter[] = useMemo(() => {
    if (audience.customFields && audience.customFields.length > 0) {
      return audience.customFields;
    }
    if (audience.customField?.fieldId) {
      return [audience.customField];
    }
    return [{ fieldId: '', operator: 'is', value: '' }];
  }, [audience.customFields, audience.customField]);

  const customFieldMatchMode = audience.customFieldMatchMode ?? 'all';

  // Load tags
  useEffect(() => {
    async function fetchTags() {
      setLoadingTags(true);
      try {
        const supabase = createClient();
        const { data } = await supabase.from('tags').select('*').order('name');
        setTags(data ?? []);
      } finally {
        setLoadingTags(false);
      }
    }
    fetchTags();
  }, []);

  // Lazy-load custom fields
  useEffect(() => {
    if (audience.type !== 'custom_field') return;
    async function fetchFields() {
      setLoadingFields(true);
      try {
        const supabase = createClient();
        const { data } = await supabase.from('custom_fields').select('*').order('field_name');
        setCustomFields(data ?? []);
      } finally {
        setLoadingFields(false);
      }
    }
    fetchFields();
  }, [audience.type]);

  // Estimate count
  const estimateSeq = useRef(0);
  const fetchEstimatedCount = useCallback(async () => {
    const seq = ++estimateSeq.current;
    setLoadingCount(true);
    let count: number | null;
    try {
      count = await countAudience(createClient(), {
        type: audience.type,
        tagIds: audience.tagIds,
        tagMatchMode: audience.tagMatchMode,
        customField: audience.customField,
        customFields: audience.customFields,
        customFieldMatchMode: audience.customFieldMatchMode,
        csvContacts: audience.csvContacts,
        manualContacts: audience.manualContacts,
        excludeTagIds: audience.excludeTagIds,
      });
    } catch {
      count = null;
    }
    if (seq !== estimateSeq.current) return;
    setEstimatedCount(count);
    setLoadingCount(false);
  }, [audience]);

  useEffect(() => {
    fetchEstimatedCount();
  }, [fetchEstimatedCount]);

  // Handle Excel / CSV File
  async function handleSpreadsheetChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    try {
      const buffer = await selected.arrayBuffer();
      const result = parseExcelOrCsv(buffer);

      if (result.records.length === 0) {
        toast.error('The spreadsheet contains no data or could not be read.');
        return;
      }

      const validContacts = result.records
        .filter((r) => r.valid)
        .map((r) => ({ phone: r.phone, name: r.name }));

      if (validContacts.length === 0) {
        toast.error('No valid phone numbers found in the spreadsheet.');
        return;
      }

      setPickedFileName(selected.name);

      if (result.invalidRecords.length > 0) {
        setExcelErrorReport(generateErrorReportCsv(result.invalidRecords));
        toast.warning(
          `Found ${validContacts.length} valid numbers. ${result.invalidCount} invalid, ${result.duplicateCount} duplicates excluded.`
        );
      } else {
        setExcelErrorReport(null);
        toast.success(`Loaded ${validContacts.length} valid contacts from ${selected.name}`);
      }

      onUpdate({
        ...audience,
        csvContacts: validContacts,
      });
    } catch (err) {
      console.error('Spreadsheet parse error:', err);
      toast.error('Failed to parse file. Ensure it is a valid .xlsx, .xls, or .csv file.');
    } finally {
      if (e.target) e.target.value = '';
    }
  }

  // Handle Manual Numbers Textarea
  function handleManualTextChange(text: string) {
    setManualText(text);
    const parsed = parseManualPhoneNumbers(text);

    setManualStats({
      total: parsed.total,
      validCount: parsed.valid.length,
      invalidCount: parsed.invalid.length,
      duplicatesCount: parsed.duplicatesCount,
      invalidSamples: parsed.invalid.slice(0, 5),
    });

    onUpdate({
      ...audience,
      manualContacts: parsed.valid.map((v) => ({ phone: v.phone, name: v.name })),
    });
  }

  // Tags toggle
  function toggleTag(tagId: string) {
    const current = audience.tagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, tagIds: updated });
  }

  function setTagMode(mode: 'any' | 'all') {
    onUpdate({ ...audience, tagMatchMode: mode });
  }

  // Exclude tags
  function toggleExcludeTag(tagId: string) {
    const current = audience.excludeTagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, excludeTagIds: updated });
  }

  // Custom fields conditions
  function updateCondition(index: number, patch: Partial<CustomFieldFilter>) {
    const next = [...conditions];
    next[index] = { ...next[index], ...patch };
    onUpdate({
      ...audience,
      customField: next[0],
      customFields: next,
    });
  }

  function addCondition() {
    const next = [...conditions, { fieldId: '', operator: 'is' as CustomFieldOperator, value: '' }];
    onUpdate({
      ...audience,
      customField: next[0],
      customFields: next,
    });
  }

  function removeCondition(index: number) {
    const next = conditions.filter((_, i) => i !== index);
    const finalConditions = next.length > 0 ? next : [{ fieldId: '', operator: 'is' as CustomFieldOperator, value: '' }];
    onUpdate({
      ...audience,
      customField: finalConditions[0],
      customFields: finalConditions,
    });
  }

  function setCustomFieldMode(mode: 'all' | 'any') {
    onUpdate({ ...audience, customFieldMatchMode: mode });
  }

  // Preview matching contacts
  async function loadPreview() {
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const supabase = createClient();
      if (audience.type === 'manual') {
        const list = (audience.manualContacts ?? []).map((m) => ({
          name: m.name,
          phone: m.phone,
        }));
        setPreviewList(list);
      } else if (audience.type === 'csv') {
        const list = (audience.csvContacts ?? []).map((c) => ({
          name: c.name,
          phone: c.phone,
        }));
        setPreviewList(list);
      } else {
        const contacts = await resolveAudienceContacts(
          supabase,
          audience,
          async (c) => c as unknown as Contact[],
          async (m) => m as unknown as Contact[],
        );
        setPreviewList(
          contacts.slice(0, 100).map((c) => ({
            name: c.name,
            phone: c.phone,
          }))
        );
      }
    } catch (err) {
      console.error('Preview load error:', err);
      toast.error('Could not load recipient preview.');
    } finally {
      setPreviewLoading(false);
    }
  }

  const isValid = useMemo(() => {
    if (audience.type === 'all') return true;
    if (audience.type === 'tags') return (audience.tagIds?.length ?? 0) > 0;
    if (audience.type === 'custom_field') {
      return conditions.some((c) => !!c.fieldId && c.value.trim().length > 0);
    }
    if (audience.type === 'csv') return (audience.csvContacts?.length ?? 0) > 0;
    if (audience.type === 'manual') return (audience.manualContacts?.length ?? 0) > 0;
    return false;
  }, [audience, conditions]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Select Audience</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose who should receive this broadcast campaign
        </p>
      </div>

      {/* Audience Mode Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {audienceOptions.map((opt) => {
          const isSelected = audience.type === opt.type;
          const Icon = opt.icon;
          return (
            <button
              key={opt.type}
              type="button"
              onClick={() => {
                onUpdate({
                  ...audience,
                  type: opt.type,
                });
              }}
              className={`flex flex-col items-start rounded-xl border p-4 text-left transition-all ${
                isSelected
                  ? 'border-primary bg-primary/10 shadow-sm'
                  : 'border-border bg-card/60 hover:border-border hover:bg-card'
              }`}
            >
              <div
                className={`mb-3 rounded-lg p-2 ${
                  isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-foreground">{opt.label}</p>
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{opt.description}</p>
            </button>
          );
        })}
      </div>

      {/* FILTER BY TAGS SECTION */}
      {audience.type === 'tags' && (
        <div className="rounded-xl border border-border bg-card/50 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Select Contact Tags</p>
              <p className="text-xs text-muted-foreground">Contacts with any or all of these tags will be included</p>
            </div>
            {/* AND / OR toggle */}
            <div className="inline-flex rounded-lg border border-border bg-muted/60 p-1 text-xs font-medium">
              <button
                type="button"
                onClick={() => setTagMode('any')}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  tagMatchMode === 'any' ? 'bg-primary text-primary-foreground font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Match Any (OR)
              </button>
              <button
                type="button"
                onClick={() => setTagMode('all')}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  tagMatchMode === 'all' ? 'bg-primary text-primary-foreground font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Match All (AND)
              </button>
            </div>
          </div>

          {loadingTags ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading tags...
            </div>
          ) : tags.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tags found in this account.</p>
          ) : (
            <div className="flex flex-wrap gap-2 pt-1">
              {tags.map((tag) => {
                const isSelected = audience.tagIds?.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-primary/40 bg-primary/15 text-primary shadow-sm font-semibold'
                        : 'border-border bg-muted text-muted-foreground hover:border-border hover:text-foreground'
                    }`}
                  >
                    <span
                      className="mr-1.5 h-2 w-2 rounded-full"
                      style={{ backgroundColor: tag.color || '#a855f7' }}
                    />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* CUSTOM FIELDS SECTION */}
      {audience.type === 'custom_field' && (
        <div className="rounded-xl border border-border bg-card/50 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Custom Field Conditions</p>
              <p className="text-xs text-muted-foreground">Filter contacts based on custom database attributes</p>
            </div>
            {conditions.length > 1 && (
              <div className="inline-flex rounded-lg border border-border bg-muted/60 p-1 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setCustomFieldMode('all')}
                  className={`rounded-md px-2.5 py-1 transition-colors ${
                    customFieldMatchMode === 'all' ? 'bg-primary text-primary-foreground font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Match All (AND)
                </button>
                <button
                  type="button"
                  onClick={() => setCustomFieldMode('any')}
                  className={`rounded-md px-2.5 py-1 transition-colors ${
                    customFieldMatchMode === 'any' ? 'bg-primary text-primary-foreground font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Match Any (OR)
                </button>
              </div>
            )}
          </div>

          {loadingFields ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading fields...
            </div>
          ) : customFields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No custom fields found. Add custom fields under Settings → Fields & Tags.
            </p>
          ) : (
            <div className="space-y-3">
              {conditions.map((cond, idx) => (
                <div key={idx} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <select
                    value={cond.fieldId}
                    onChange={(e) => updateCondition(idx, { fieldId: e.target.value })}
                    className="h-9 flex-1 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Select Field...</option>
                    {customFields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.field_name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={cond.operator}
                    onChange={(e) => updateCondition(idx, { operator: e.target.value as CustomFieldOperator })}
                    className="h-9 sm:w-44 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  >
                    {OPERATOR_OPTIONS.map((op) => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>

                  <input
                    type="text"
                    value={cond.value}
                    onChange={(e) => updateCondition(idx, { value: e.target.value })}
                    placeholder="Enter value..."
                    className="h-9 flex-1 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                  />

                  {conditions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeCondition(idx)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="Remove condition"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addCondition}
                className="mt-2 text-xs gap-1.5 border-dashed"
              >
                <Plus className="h-3.5 w-3.5" /> Add Condition
              </Button>
            </div>
          )}
        </div>
      )}

      {/* UPLOAD EXCEL / CSV SECTION */}
      {audience.type === 'csv' && (
        <div className="rounded-xl border border-border bg-card/50 p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Upload Excel (.xlsx, .xls) or CSV</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Must include a column for mobile/phone numbers (Indian formats like 9876543210 and international are supported). Optional name & tags columns.
            </p>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="group flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center transition-all hover:border-primary/40 hover:bg-muted/60"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:scale-105 transition-transform">
              {pickedFileName ? <FileText className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
            </div>
            <p className="text-sm font-medium text-foreground">
              {pickedFileName ? pickedFileName : 'Click to browse Excel (.xlsx, .xls) or CSV file'}
            </p>
            {(audience.csvContacts?.length ?? 0) > 0 && (
              <p className="text-xs font-semibold text-primary">
                ✓ {audience.csvContacts?.length} valid contacts loaded
              </p>
            )}
          </button>

          {excelErrorReport && (
            <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
                <span>Some records had invalid phone numbers or duplicates.</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const blob = new Blob([excelErrorReport], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'import-errors.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="h-7 text-[11px] gap-1 border-amber-500/40 text-amber-300 hover:bg-amber-500/20"
              >
                <Download className="h-3 w-3" /> Download Error Report
              </Button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,.xls"
            onChange={handleSpreadsheetChange}
            className="hidden"
          />
        </div>
      )}

      {/* MANUAL PHONE NUMBER ENTRY SECTION */}
      {audience.type === 'manual' && (
        <div className="rounded-xl border border-border bg-card/50 p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Manual Phone Number Entry</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Paste phone numbers below (one per line or comma-separated). Indian mobile numbers (e.g. 9876543210) and international numbers with country code (+1...) are supported.
            </p>
          </div>

          <textarea
            value={manualText}
            onChange={(e) => handleManualTextChange(e.target.value)}
            rows={6}
            placeholder={`Example:\n9876543210\n9876501234\n919876512345\nRahul: 9876599999\n+1 (415) 555-2671`}
            className="w-full rounded-xl border border-border bg-muted/50 p-3 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />

          {/* Real-time stats pills */}
          {manualStats.total > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-center">
              <div className="rounded-lg border border-border bg-muted/40 p-2">
                <p className="text-[11px] text-muted-foreground">Total Entered</p>
                <p className="text-base font-bold text-foreground">{manualStats.total}</p>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2">
                <p className="text-[11px] text-emerald-400">Valid Numbers</p>
                <p className="text-base font-bold text-emerald-400">{manualStats.validCount}</p>
              </div>
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-2">
                <p className="text-[11px] text-blue-400">Duplicates Removed</p>
                <p className="text-base font-bold text-blue-400">{manualStats.duplicatesCount}</p>
              </div>
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2">
                <p className="text-[11px] text-rose-400">Invalid Excluded</p>
                <p className="text-base font-bold text-rose-400">{manualStats.invalidCount}</p>
              </div>
            </div>
          )}

          {manualStats.invalidSamples.length > 0 && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
              <p className="font-semibold mb-1">Invalid Number Warnings:</p>
              <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                {manualStats.invalidSamples.map((inv, idx) => (
                  <li key={idx}>
                    <code className="font-bold">{inv.raw}</code> — {inv.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* EXCLUDE TAGS - Global across audience */}
      <div className="rounded-xl border border-border bg-card/50 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <X className="h-4 w-4 text-rose-400" />
          <p className="text-sm font-semibold text-foreground">Exclude Contacts with Tags</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Any contact carrying an excluded tag will be removed from this broadcast
        </p>

        {tags.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tags available to exclude.</p>
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            {tags.map((tag) => {
              const isExcluded = audience.excludeTagIds?.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleExcludeTag(tag.id)}
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                    isExcluded
                      ? 'border-rose-500/40 bg-rose-500/20 text-rose-300 font-semibold shadow-sm'
                      : 'border-border bg-muted text-muted-foreground hover:border-border hover:text-foreground'
                  }`}
                >
                  <span
                    className="mr-1.5 h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color || '#f43f5e' }}
                  />
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ESTIMATED REACH & PREVIEW BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-border bg-card/70 p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Estimated Recipients</p>
            <div className="flex items-center gap-2">
              {loadingCount ? (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Calculating...
                </div>
              ) : estimatedCount !== null ? (
                <span className="text-xl font-bold tracking-tight text-foreground">
                  {estimatedCount.toLocaleString()}{' '}
                  <span className="text-xs font-normal text-muted-foreground">recipients</span>
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">Configure audience above</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {estimatedCount !== null && estimatedCount > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={loadPreview}
              className="gap-1.5 text-xs"
            >
              <Eye className="h-3.5 w-3.5" /> Preview Recipients
            </Button>
          )}
        </div>
      </div>

      {/* RECIPIENT PREVIEW MODAL / ACCORDION */}
      {previewOpen && (
        <div className="rounded-xl border border-primary/20 bg-card p-5 space-y-3 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold text-foreground">
                Recipient Preview (Showing up to 100 matching recipients)
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPreviewOpen(false)}
              className="h-7 w-7 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {previewLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary mr-2" /> Resolving matching contacts...
            </div>
          ) : previewList.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No matching recipients found with the selected criteria.
            </p>
          ) : (
            <div className="max-h-60 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {previewList.map((rec, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-6 text-right font-mono">{i + 1}.</span>
                    <span className="font-medium text-foreground">{rec.name || 'Unnamed Contact'}</span>
                  </div>
                  <span className="font-mono text-muted-foreground">{rec.phone}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <Button type="button" variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button
          type="button"
          onClick={onNext}
          disabled={!isValid || estimatedCount === 0}
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Next: Personalize <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
