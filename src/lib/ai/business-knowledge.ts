import type { SupabaseClient } from '@supabase/supabase-js';
import { ingestDocument } from './knowledge';
import type { BusinessInfo } from './smart-prompt';

export interface IngestedDocSummary {
  id: string;
  title: string;
  category: string;
}

export async function syncBusinessKnowledgeToDatabase(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  info: BusinessInfo,
  embeddingsApiKey: string | null = null
): Promise<{ documentsCreated: number; documents: IngestedDocSummary[] }> {
  const name = info.businessName?.trim() || 'Business';
  const docsToUpsert: Array<{ title: string; category: string; content: string }> = [];

  // 1. Company Profile
  const profileParts: string[] = [];
  profileParts.push(`Company / Business Name: ${name}`);
  if (info.industry?.trim()) profileParts.push(`Industry: ${info.industry.trim()}`);
  if (info.description?.trim()) profileParts.push(`Description: ${info.description.trim()}`);
  if (info.businessHours?.trim()) profileParts.push(`Business Hours: ${info.businessHours.trim()}`);
  if (info.contactInfo?.trim()) profileParts.push(`Contact Info & Location: ${info.contactInfo.trim()}`);

  if (profileParts.length >= 1) {
    docsToUpsert.push({
      title: `[Company Profile] ${name}`,
      category: 'general',
      content: profileParts.join('\n'),
    });
  }

  // 2. Services & Pricing
  if (info.servicesAndPricing?.trim()) {
    docsToUpsert.push({
      title: `[Services & Pricing] ${name}`,
      category: 'price_list',
      content: `Official Services and Pricing for ${name}:\n\n${info.servicesAndPricing.trim()}`,
    });
  }

  // 3. Policies & Terms
  if (info.policies?.trim()) {
    docsToUpsert.push({
      title: `[Policies & Terms] ${name}`,
      category: 'rule',
      content: `Customer Policies, Cancellation, Refund and Service Terms for ${name}:\n\n${info.policies.trim()}`,
    });
  }

  // 4. FAQs
  if (info.faqs?.trim()) {
    docsToUpsert.push({
      title: `[Frequently Asked Questions] ${name}`,
      category: 'faq',
      content: `Frequently Asked Questions and Answers for ${name}:\n\n${info.faqs.trim()}`,
    });
  }

  const results: IngestedDocSummary[] = [];

  for (const item of docsToUpsert) {
    // Check if document with this title already exists
    const { data: existing } = await db
      .from('ai_knowledge_documents')
      .select('id')
      .eq('account_id', accountId)
      .eq('title', item.title)
      .maybeSingle();

    let docId: string;

    if (existing?.id) {
      docId = existing.id;
      await db
        .from('ai_knowledge_documents')
        .update({
          content: item.content,
          category: item.category,
          updated_at: new Date().toISOString(),
        })
        .eq('id', docId);
    } else {
      const { data: inserted, error } = await db
        .from('ai_knowledge_documents')
        .insert({
          account_id: accountId,
          created_by: userId,
          title: item.title,
          content: item.content,
          category: item.category,
        })
        .select('id')
        .single();

      if (error || !inserted) {
        console.error('[business-knowledge] Insert error:', error);
        continue;
      }
      docId = inserted.id;
    }

    // Ingest chunks (and embeddings if key available)
    try {
      await ingestDocument(
        db,
        accountId,
        { embeddingsApiKey },
        docId,
        item.content
      );
    } catch (ingestErr) {
      console.warn('[business-knowledge] Ingest chunk warning (continuing):', ingestErr);
    }

    results.push({
      id: docId,
      title: item.title,
      category: item.category,
    });
  }

  return {
    documentsCreated: results.length,
    documents: results,
  };
}
