export function normalizeDomain(value = '') {
  return value.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
}
const exactReject = new Set(['shopify.com','apps.shopify.com','partners.shopify.com','help.shopify.com']);
const rejectPrefixes = ['help.','docs.','support.','blog.','status.','community.','developers.'];
const rejectTitleTerms = ['app store','shopify app','app directory','help center','documentation','developer','directory','translate your store','currency converter'];
export function qualifyProspect(p) {
  const domain = normalizeDomain(p.domain), title = String(p.store_name || '').toLowerCase();
  const evidence = p.metadata?.evidence || {}, shopify = Number(p.platform_confidence || 0);
  const commerce = !!p.commerce_signal, review = !!p.review_signal, feedback = !!p.feedback_signal;
  const shopifyHits = Number(evidence.shopifyHits || 0);
  const hardReject = exactReject.has(domain) || domain.endsWith('.shopify.com') || domain.endsWith('.myshopify.com') || rejectPrefixes.some(x => domain.startsWith(x)) || rejectTitleTerms.some(x => title.includes(x));
  if (hardReject) return { score: 0, merchantConfidence: 0, status: 'rejected', reason: 'ecosystem_or_service_domain' };
  let merchantConfidence = 0;
  if (commerce) merchantConfidence += 35; if (review) merchantConfidence += 20; if (feedback) merchantConfidence += 20;
  if (shopify >= 90) merchantConfidence += 15; else if (shopify >= 70) merchantConfidence += 10; else if (shopify >= 50) merchantConfidence += 5;
  if (shopifyHits >= 4) merchantConfidence += 5; merchantConfidence = Math.min(100, merchantConfidence);
  let score = Math.min(shopify * 0.25, 25); if (commerce) score += 20; if (review) score += 20; if (feedback) score += 15;
  if (merchantConfidence >= 70) score += 20; else if (merchantConfidence >= 50) score += 10;
  score = Math.round(Math.min(100, score));
  const status = merchantConfidence >= 70 && score >= 70 ? 'priority' : merchantConfidence >= 50 && score >= 45 ? 'qualified' : 'rejected';
  return { score, merchantConfidence, status, reason: status };
}
