export function parseTrustpilotEvidence({
  url,
  title = '',
  description = '',
}) {
  const text = `${title} ${description}`.toLowerCase();

  const categories = [];

  if (
    text.includes('poor') ||
    text.includes('bad') ||
    text.includes('disappointed')
  ) {
    categories.push('service_failure');
  }

  if (
    text.includes('refund') ||
    text.includes('missing')
  ) {
    categories.push('refund_issue');
  }

  if (
    text.includes('delivery') ||
    text.includes('shipping') ||
    text.includes('delay')
  ) {
    categories.push('delivery_issue');
  }

  if (text.includes('damaged')) {
    categories.push('damage_issue');
  }

  return {
    provider: 'trustpilot',
    url,
    categories,
    text: description,
    confidence: categories.length > 0 ? 'medium' : 'low',
  };
}
