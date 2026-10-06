const SHOPIFY_PATTERNS = [
  /cdn\.shopify\.com/i,
  /\.myshopify\.com/i,
  /Shopify\.theme/i,
  /shopify-checkout/i,
  /shopify-section/i,
  /\/cdn\/shop\//i,
  /Shopify\.routes/i,
];

const REVIEW_PATTERNS = [
  ['judgeme', /judge\.me|judgeme/i],
  ['yotpo', /yotpo/i],
  ['loox', /loox/i],
  ['reviews.io', /reviews\.io/i],
  ['trustpilot', /trustpilot/i],
  ['stamped', /stamped\.io|stamped-reviews/i],
  ['okendo', /okendo/i],
  ['reviews', /customer reviews?|verified purchase|write a review|reviews?\b/i],
];

const COMMERCE_PATTERNS = [
  /add to cart/i,
  /buy now/i,
  /add to bag/i,
  /shop now/i,
  /\bproducts?\b/i,
];

function normalizeDomain(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!host || host.includes('google.') || host.includes('brave.') || host.includes('facebook.') || host.includes('instagram.') || host.includes('youtube.')) return null;
    return host;
  } catch {
    return null;
  }
}

export async function inspectSite(rawUrl) {
  const domain = normalizeDomain(rawUrl);
  if (!domain) return null;

  const url = `https://${domain}/`;
  let response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'CustomerVoiceAI-Discovery/1.0' },
      signal: AbortSignal.timeout(12000),
    });
  } catch (error) {
    return { domain, reachable: false, error: String(error.message || error) };
  }

  const html = await response.text();
  const lower = html.toLowerCase();
  const shopifyHits = SHOPIFY_PATTERNS.filter((p) => p.test(html)).length;
  const reviewMatches = REVIEW_PATTERNS.filter(([, p]) => p.test(html));
  const commerceHits = COMMERCE_PATTERNS.filter((p) => p.test(html)).length;

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const storeName = titleMatch?.[1]?.replace(/\s+/g, ' ').trim().slice(0, 200) || domain;

  const platformConfidence = Math.min(100, shopifyHits * 25);
  const reviewPlatform = reviewMatches.find(([name]) => name !== 'reviews')?.[0] || null;
  const reviewSignal = reviewMatches.length > 0;
  const feedbackSignal = /customer reviews?|verified purchase|write a review|review/i.test(lower);
  const commerceSignal = commerceHits >= 1;

  let score = 0;
  score += platformConfidence * 0.45;
  if (reviewSignal) score += 20;
  if (feedbackSignal) score += 15;
  if (commerceSignal) score += 10;
  if (response.status >= 200 && response.status < 400) score += 5;

  return {
    domain,
    reachable: response.status >= 200 && response.status < 400,
    httpStatus: response.status,
    storeName,
    platform: platformConfidence >= 50 ? 'shopify' : 'unknown',
    platformConfidence: Math.round(platformConfidence),
    reviewSignal,
    reviewPlatform,
    feedbackSignal,
    commerceSignal,
    qualificationScore: Math.round(Math.min(100, score)),
    evidence: {
      shopifyHits,
      reviewSignals: reviewMatches.map(([name]) => name),
      commerceHits,
    },
  };
}

export { normalizeDomain };
