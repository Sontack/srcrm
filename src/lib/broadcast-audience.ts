import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllInChunks, fetchAllPages } from '@/lib/supabase/paged-query';
import type { Contact } from '@/types';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains' | 'gt' | 'lt';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export type AudienceType = 'all' | 'tags' | 'custom_field' | 'csv' | 'manual';

export interface CsvAudienceRow {
  phone: string;
  name?: string;
}

export interface ManualAudienceRow {
  phone: string;
  name?: string;
}

export interface AudienceConfig {
  type: AudienceType;
  tagIds?: string[];
  tagMatchMode?: 'any' | 'all';
  customField?: CustomFieldFilter;
  customFields?: CustomFieldFilter[];
  customFieldMatchMode?: 'all' | 'any';
  csvContacts?: CsvAudienceRow[];
  manualContacts?: ManualAudienceRow[];
  excludeTagIds?: string[];
}

async function withContext<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch ${label}: ${message}`);
  }
}

export function fetchTaggedContactIds(
  db: SupabaseClient,
  tagIds: readonly string[],
  matchMode: 'any' | 'all' = 'any',
): Promise<Set<string>> {
  return withContext('contact tags', async () => {
    if (tagIds.length === 0) return new Set();

    if (matchMode === 'all' && tagIds.length > 1) {
      // Must have ALL selected tags
      let intersection: Set<string> | null = null;
      for (const singleTagId of tagIds) {
        const rows = await fetchAllPages<{ contact_id: string }>((from, to) =>
          db
            .from('contact_tags')
            .select('contact_id')
            .eq('tag_id', singleTagId)
            .order('id')
            .range(from, to),
        );
        const currentSet = new Set(rows.map((r) => r.contact_id));
        if (intersection === null) {
          intersection = currentSet;
        } else {
          const next = new Set<string>();
          for (const id of intersection) {
            if (currentSet.has(id)) next.add(id);
          }
          intersection = next;
        }
        if (intersection.size === 0) break;
      }
      return intersection ?? new Set();
    }

    // Default: 'any' (union)
    const rows = await fetchAllInChunks<{ contact_id: string }, string>(
      tagIds,
      (slice, from, to) =>
        db
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', slice)
          .order('id')
          .range(from, to),
    );
    return new Set(rows.map((row) => row.contact_id));
  });
}

function compareValues(actual: string | null, expected: string, operator: CustomFieldOperator): boolean {
  const actualStr = actual ?? '';
  if (operator === 'is') return actualStr.toLowerCase() === expected.toLowerCase();
  if (operator === 'is_not') return actualStr.toLowerCase() !== expected.toLowerCase();
  if (operator === 'contains') return actualStr.toLowerCase().includes(expected.toLowerCase());

  // gt / lt numeric or date comparison
  const numActual = Number(actualStr);
  const numExpected = Number(expected);
  if (!Number.isNaN(numActual) && !Number.isNaN(numExpected)) {
    if (operator === 'gt') return numActual > numExpected;
    if (operator === 'lt') return numActual < numExpected;
  }

  // Fallback to lexicographic comparison
  if (operator === 'gt') return actualStr > expected;
  if (operator === 'lt') return actualStr < expected;

  return false;
}

export function fetchSingleCustomFieldContactIds(
  db: SupabaseClient,
  filter: CustomFieldFilter,
): Promise<Set<string>> {
  return withContext('custom field matches', async () => {
    const { fieldId, operator, value } = filter;

    // For gt and lt, fetch values for field and filter in memory
    if (operator === 'gt' || operator === 'lt') {
      const rows = await fetchAllPages<{ contact_id: string; value: string | null }>((from, to) =>
        db
          .from('contact_custom_values')
          .select('contact_id, value')
          .eq('custom_field_id', fieldId)
          .order('id')
          .range(from, to),
      );
      const matched = rows.filter((r) => compareValues(r.value, value, operator));
      return new Set(matched.map((r) => r.contact_id));
    }

    const rows = await fetchAllPages<{ contact_id: string }>((from, to) => {
      let query = db
        .from('contact_custom_values')
        .select('contact_id')
        .eq('custom_field_id', fieldId);
      if (operator === 'is') query = query.eq('value', value);
      else if (operator === 'is_not') query = query.neq('value', value);
      else query = query.ilike('value', `%${value}%`);
      return query.order('id').range(from, to);
    });
    return new Set(rows.map((row) => row.contact_id));
  });
}

export async function fetchCustomFieldContactIds(
  db: SupabaseClient,
  filterOrFilters: CustomFieldFilter | CustomFieldFilter[],
  matchMode: 'all' | 'any' = 'all',
): Promise<Set<string>> {
  const filters = Array.isArray(filterOrFilters) ? filterOrFilters : [filterOrFilters];
  const activeFilters = filters.filter((f) => f.fieldId && f.value.trim().length > 0);
  if (activeFilters.length === 0) return new Set();

  if (activeFilters.length === 1) {
    return fetchSingleCustomFieldContactIds(db, activeFilters[0]);
  }

  let result: Set<string> | null = null;
  for (const filter of activeFilters) {
    const matched = await fetchSingleCustomFieldContactIds(db, filter);
    if (result === null) {
      result = matched;
    } else if (matchMode === 'all') {
      const next = new Set<string>();
      for (const id of result) {
        if (matched.has(id)) next.add(id);
      }
      result = next;
    } else {
      for (const id of matched) result.add(id);
    }
  }

  return result ?? new Set();
}

export function fetchContactsByIds(
  db: SupabaseClient,
  ids: readonly string[],
): Promise<Contact[]> {
  return withContext('contacts', () =>
    fetchAllInChunks<Contact, string>(ids, (slice, from, to) =>
      db.from('contacts').select('*').in('id', slice).order('id').range(from, to),
    ),
  );
}

export function fetchAllContacts(db: SupabaseClient): Promise<Contact[]> {
  return withContext('contacts', () =>
    fetchAllPages<Contact>((from, to) =>
      db.from('contacts').select('*').order('id').range(from, to),
    ),
  );
}

async function fetchExcludedIds(
  db: SupabaseClient,
  audience: AudienceConfig,
): Promise<Set<string>> {
  if (!audience.excludeTagIds || audience.excludeTagIds.length === 0) {
    return new Set();
  }
  return fetchTaggedContactIds(db, audience.excludeTagIds);
}

function hasCustomFieldFilter(
  audience: AudienceConfig,
): audience is AudienceConfig & { customField: CustomFieldFilter } {
  return Boolean(
    (audience.customFields && audience.customFields.length > 0) ||
    audience.customField?.fieldId,
  );
}

async function fetchAudienceContactIds(
  db: SupabaseClient,
  audience: AudienceConfig,
): Promise<Set<string> | null> {
  if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
    return fetchTaggedContactIds(db, audience.tagIds, audience.tagMatchMode ?? 'any');
  }
  if (audience.type === 'custom_field' && hasCustomFieldFilter(audience)) {
    const filters = audience.customFields && audience.customFields.length > 0
      ? audience.customFields
      : audience.customField!;
    return fetchCustomFieldContactIds(db, filters, audience.customFieldMatchMode ?? 'all');
  }
  return null;
}

export async function resolveAudienceContacts(
  db: SupabaseClient,
  audience: AudienceConfig,
  resolveCsv: (rows: CsvAudienceRow[]) => Promise<Contact[]>,
  resolveManual?: (rows: ManualAudienceRow[]) => Promise<Contact[]>,
): Promise<Contact[]> {
  const excluded = await fetchExcludedIds(db, audience);
  const keep = (contact: Contact) => !excluded.has(contact.id);

  if (audience.type === 'all') {
    return (await fetchAllContacts(db)).filter(keep);
  }
  if (audience.type === 'csv') {
    if (!audience.csvContacts) return [];
    return (await resolveCsv(audience.csvContacts)).filter(keep);
  }
  if (audience.type === 'manual') {
    if (!audience.manualContacts) return [];
    const resolver = resolveManual || resolveCsv;
    return (await resolver(audience.manualContacts)).filter(keep);
  }

  const ids = await fetchAudienceContactIds(db, audience);
  if (!ids) return [];
  const wanted = [...ids].filter((id) => !excluded.has(id));
  if (wanted.length === 0) return [];
  return fetchContactsByIds(db, wanted);
}

export async function countAudience(
  db: SupabaseClient,
  audience: AudienceConfig,
): Promise<number | null> {
  if (audience.type === 'csv') {
    return audience.csvContacts && audience.csvContacts.length > 0
      ? audience.csvContacts.length
      : null;
  }

  if (audience.type === 'manual') {
    return audience.manualContacts && audience.manualContacts.length > 0
      ? audience.manualContacts.length
      : null;
  }

  if (audience.type === 'all') {
    const { count, error } = await db
      .from('contacts')
      .select('id', { count: 'exact', head: true });
    if (error) throw new Error(`Failed to count contacts: ${error.message}`);
    const total = count ?? 0;
    const excluded = await fetchExcludedIds(db, audience);
    return Math.max(0, total - excluded.size);
  }

  if (audience.type === 'custom_field') {
    const hasField = audience.customFields?.some((f) => f.fieldId && f.value.trim().length > 0) ||
      (audience.customField?.fieldId && audience.customField.value.trim().length > 0);
    if (!hasField) return null;
  }

  const ids = await fetchAudienceContactIds(db, audience);
  if (!ids) return null;
  const excluded = await fetchExcludedIds(db, audience);
  let size = 0;
  for (const id of ids) if (!excluded.has(id)) size++;
  return size;
}
