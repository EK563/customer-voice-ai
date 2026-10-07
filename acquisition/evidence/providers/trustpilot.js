const TRUSTPILOT_HOSTS = [
  'trustpilot.com',
  'www.trustpilot.com',
];

export function isTrustpilotResult(url) {
  try {
    const parsed = new URL(url);

    return TRUSTPILOT_HOSTS.includes(
      parsed.hostname.toLowerCase()
    );
  } catch {
    return false;
  }
}

export function parseTrustpilotEvidence({
  url,
  title = '',
  description = '',
  pageAge = null,
  query = '',
}) {
  if (!isTrustpilotResult(url)) {
    return null;
  }

  const text = `${title} ${description}`
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return null;
  }

  const lower = text.toLowerCase();

  const categories = [];

  if (
    /poor|bad service|poor service|disappointed|wouldn['’]?t recommend|would not recommend/.test(
      lower
    )
  ) {
    categories.push('service_failure');
  }

  if (
    /refund|missing|never received|never arrived|did not receive|didn['’]?t receive/.test(
      lower
    )
  ) {
    categories.push('refund_issue');
  }

  if (
    /delivery|shipping|delay|late/.test(lower)
  ) {
    categories.push('delivery_issue');
  }

  if (
    /damaged|broken|arrived damaged/.test(lower)
  ) {
    categories.push('damage_issue');
  }

  if (
    /quality|poor quality|bad quality/.test(lower)
  ) {
    categories.push('quality_issue');
  }

  if (!categories.length) {
    return null;
  }

  return {
    provider: 'trustpilot',
    url,
    title,
    description,
    query,
    pageAge,
    categories,
    text,
    confidence:
      categories.length >= 2
        ? 'high'
        : 'medium',
  };
}
