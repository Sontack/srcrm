import { describe, expect, it } from 'vitest';
import { buildSmartSystemPrompt } from './smart-prompt';

describe('buildSmartSystemPrompt', () => {
  it('builds system prompt with business identity and guidelines', () => {
    const prompt = buildSmartSystemPrompt({
      businessName: 'Acme Dental Clinic',
      industry: 'Healthcare',
      description: 'Comprehensive dental care and implants.',
      contactInfo: 'Phone: +1 555-0199',
      businessHours: 'Mon-Fri 9am-6pm',
      servicesAndPricing: 'Teeth Cleaning: $80\nFilling: $120',
      policies: 'Cancel 24h prior or $25 fee applies',
      faqs: 'Q: Do you accept insurance? A: Yes, Delta and Cigna.',
    });

    expect(prompt).toContain('Acme Dental Clinic');
    expect(prompt).toContain('Healthcare');
    expect(prompt).toContain('Teeth Cleaning: $80');
    expect(prompt).toContain('Cancel 24h prior');
    expect(prompt).toContain('ZERO HALLUCINATION (STRICT)');
    expect(prompt).toContain('LANGUAGE MATCHING');
    expect(prompt).toContain('WHATSAPP FORMATTING');
  });

  it('handles sparse business info gracefully with default fallback', () => {
    const prompt = buildSmartSystemPrompt({
      businessName: '',
    });

    expect(prompt).toContain('Our Business');
    expect(prompt).toContain('ZERO HALLUCINATION (STRICT)');
  });
});
