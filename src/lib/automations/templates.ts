import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'
import { getT } from '@/lib/i18n/translate'

export type TemplateSlug =
  | 'welcome_message'
  | 'out_of_office'
  | 'lead_qualifier'
  | 'follow_up_reminder'
  | 'ai_customer_support'
  | 'auto_faq_reply'
  | 'auto_price_inquiry'
  | 'document_info_reply'
  | 'appointment_assistance'
  | 'human_handover'
  | 'custom_webhook'
  | 'n8n_trigger';

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
}

const t = getT('StarterAutomations')

/** Comma-separated keyword list from the catalogue → trimmed array. */
function keywords(key: string): string[] {
  return t(key)
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
}

export const AUTOMATION_TEMPLATES: Record<TemplateSlug, AutomationTemplateDefinition> = {
  welcome_message: {
    slug: 'welcome_message',
    name: t('welcome_message.name'),
    description: t('welcome_message.description'),
    // first_inbound_message (added in PR #33) catches both brand-new
    // contacts AND manually-added/imported contacts on their first-ever
    // reply, which is what a user setting up a "welcome" automation
    // almost always wants. new_contact_created would miss the
    // manually-imported case.
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: t('welcome_message.text'),
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },
  out_of_office: {
    slug: 'out_of_office',
    name: t('out_of_office.name'),
    description: t('out_of_office.description'),
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'condition',
        step_config: {
          subject: 'time_of_day',
          operand: '18:00-09:00',
        },
      },
      {
        step_type: 'send_message',
        step_config: {
          text: t('out_of_office.text'),
        },
        parent_index: 0,
        branch: 'yes',
      },
    ],
  },
  lead_qualifier: {
    slug: 'lead_qualifier',
    name: t('lead_qualifier.name'),
    description: t('lead_qualifier.description'),
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: keywords('lead_qualifier.keywords'),
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: t('lead_qualifier.text'),
        },
      },
      {
        step_type: 'wait',
        step_config: { amount: 10, unit: 'minutes' },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },
  follow_up_reminder: {
    slug: 'follow_up_reminder',
    name: t('follow_up_reminder.name'),
    description: t('follow_up_reminder.description'),
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'days' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text: t('follow_up_reminder.text'),
        },
      },
    ],
  },
  ai_customer_support: {
    slug: 'ai_customer_support',
    name: t('ai_customer_support.name'),
    description: t('ai_customer_support.description'),
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: t('ai_customer_support.text'),
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },
  auto_faq_reply: {
    slug: 'auto_faq_reply',
    name: t('auto_faq_reply.name'),
    description: t('auto_faq_reply.description'),
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: keywords('auto_faq_reply.keywords'),
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: t('auto_faq_reply.text'),
        },
      },
    ],
  },
  auto_price_inquiry: {
    slug: 'auto_price_inquiry',
    name: t('auto_price_inquiry.name'),
    description: t('auto_price_inquiry.description'),
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: keywords('auto_price_inquiry.keywords'),
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: t('auto_price_inquiry.text'),
        },
      },
    ],
  },
  document_info_reply: {
    slug: 'document_info_reply',
    name: t('document_info_reply.name'),
    description: t('document_info_reply.description'),
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: keywords('document_info_reply.keywords'),
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: t('document_info_reply.text'),
        },
      },
    ],
  },
  appointment_assistance: {
    slug: 'appointment_assistance',
    name: t('appointment_assistance.name'),
    description: t('appointment_assistance.description'),
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: keywords('appointment_assistance.keywords'),
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: t('appointment_assistance.text'),
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },
  human_handover: {
    slug: 'human_handover',
    name: t('human_handover.name'),
    description: t('human_handover.description'),
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: keywords('human_handover.keywords'),
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: t('human_handover.text'),
        },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },
  custom_webhook: {
    slug: 'custom_webhook',
    name: t('custom_webhook.name'),
    description: t('custom_webhook.description'),
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: t('custom_webhook.text'),
        },
      },
    ],
  },
  n8n_trigger: {
    slug: 'n8n_trigger',
    name: t('n8n_trigger.name'),
    description: t('n8n_trigger.description'),
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: t('n8n_trigger.text'),
        },
      },
    ],
  },
}

export function getTemplate(slug: string): AutomationTemplateDefinition | null {
  return AUTOMATION_TEMPLATES[slug as TemplateSlug] ?? null
}
