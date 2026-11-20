export interface BusinessInfo {
  businessName: string;
  industry?: string;
  description?: string;
  contactInfo?: string;
  businessHours?: string;
  servicesAndPricing?: string;
  policies?: string;
  faqs?: string;
}

export function buildSmartSystemPrompt(info: BusinessInfo): string {
  const sections: string[] = [];

  const name = info.businessName?.trim() || 'Our Business';
  const industry = info.industry?.trim() ? ` in the ${info.industry.trim()} industry` : '';

  // 1. Role & Identity
  sections.push(
    `You are the official AI Customer Support Assistant for "${name}"${industry} on WhatsApp. ` +
      `Your mission is to assist customers promptly, politely, professionally, and accurately 24/7.`
  );

  // 2. Business Overview & Contact
  const overviewParts: string[] = [];
  if (info.description?.trim()) {
    overviewParts.push(`About ${name}:\n${info.description.trim()}`);
  }
  if (info.businessHours?.trim()) {
    overviewParts.push(`Operating Hours:\n${info.businessHours.trim()}`);
  }
  if (info.contactInfo?.trim()) {
    overviewParts.push(`Contact & Support Information:\n${info.contactInfo.trim()}`);
  }
  if (overviewParts.length > 0) {
    sections.push(`BUSINESS PROFILE:\n${overviewParts.join('\n\n')}`);
  }

  // 3. Services & Pricing (Verified Reference)
  if (info.servicesAndPricing?.trim()) {
    sections.push(
      `OFFICIAL SERVICES & PRICING (AUTHORITATIVE):\n${info.servicesAndPricing.trim()}`
    );
  }

  // 4. Policies (Refunds, Returns, Cancellations, Appointments)
  if (info.policies?.trim()) {
    sections.push(
      `BUSINESS POLICIES (CANCELLATION, REFUND, TERMS):\n${info.policies.trim()}`
    );
  }

  // 5. Frequently Asked Questions
  if (info.faqs?.trim()) {
    sections.push(
      `FREQUENTLY ASKED QUESTIONS (FAQS):\n${info.faqs.trim()}`
    );
  }

  // 6. Strict Behavioral, Language & Anti-Hallucination Guidelines
  sections.push(
    `CRITICAL OPERATIONAL RULES:\n` +
      `1. LANGUAGE MATCHING: Always reply in the exact language the customer uses (English, Hindi, Bengali, Hinglish, Spanish, Portuguese, etc.). Match their conversational style politely.\n` +
      `2. ZERO HALLUCINATION (STRICT): NEVER fabricate, guess, or assume prices, discounts, services, time slots, fees, or policy terms. Only quote details that exist in the business profile, pricing lists, or Knowledge Base above.\n` +
      `3. MISSING OR UNCLEAR DETAILS: If a customer requests a quote, service, or policy term that is not covered above, DO NOT invent an answer. Politely inform them that our team will confirm the exact details for them.\n` +
      `4. WHATSAPP FORMATTING: Keep messages concise, friendly, and readable on mobile screens. Use *bold* for emphasis and clean bullet points for options or lists.\n` +
      `5. GREETING & CLOSING: Greet returning or new customers warmly, provide direct answers, and offer helpful follow-up assistance.`
  );

  return sections.join('\n\n');
}
