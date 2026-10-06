import { DISCOVERY_QUERIES } from './queries.js';
import { braveSearch } from './brave-provider.server.js';
import { inspectSite } from './site-inspector.server.js';

const limitArg = Number(process.argv.find((x) => x.startsWith('--limit='))?.split('=')[1] || 20);
const limit = Math.max(1, Math.min(limitArg, 300));
const apiKey = process.env.BRAVE_SEARCH_API_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

if (!apiKey) throw new Error('Set BRAVE_SEARCH_API_KEY');
if (!supabaseUrl || !supabaseKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)');

async function supabase(path, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  return response;
}

const candidates = new Map();
for (const query of DISCOVERY_QUERIES) {
  if (candidates.size >= limit * 2) break;
  const results = await braveSearch({ apiKey, query, count: 20 });
  for (const result of results) {
    try {
      const host = new URL(result.url).hostname.toLowerCase().replace(/^www\./, '');
      if (!host || candidates.has(host)) continue;
      if (/\.(pdf|jpg|jpeg|png|gif|webp|zip)$/i.test(new URL(result.url).pathname)) continue;
      candidates.set(host, { domain: host, sourceUrl: result.url, query });
    } catch {}
  }
}

const domains = [...candidates.values()].slice(0, limit);
console.log(`Discovered ${domains.length} unique candidate domains.`);

let verified = 0;
let priority = 0;
for (const candidate of domains) {
  const site = await inspectSite(candidate.sourceUrl);
  if (!site?.reachable) continue;
  if (site.platform !== 'shopify' || site.platformConfidence < 50) continue;
  verified++;

  const status = site.qualificationScore >= 70 ? 'priority' : site.qualificationScore >= 45 ? 'qualified' : 'discovered';
  if (status === 'priority') priority++;

  const prospectPayload = {
    domain: site.domain,
    store_name: site.storeName,
    platform: site.platform,
    platform_confidence: site.platformConfidence,
    review_signal: site.reviewSignal,
    review_platform: site.reviewPlatform,
    feedback_signal: site.feedbackSignal,
    commerce_signal: site.commerceSignal,
    discovery_source: 'brave_search',
    source_url: candidate.sourceUrl,
    qualification_score: site.qualificationScore,
    status,
    metadata: { evidence: site.evidence },
  };

  const saved = await fetch(`${supabaseUrl}/rest/v1/prospects?on_conflict=domain`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(prospectPayload),
    signal: AbortSignal.timeout(15000),
  });
  if (!saved.ok) throw new Error(`Supabase prospect ${saved.status}: ${await saved.text()}`);
  const [prospect] = await saved.json();

  await supabase('prospect_sources', {
    method: 'POST',
    body: JSON.stringify({
      prospect_id: prospect.id,
      source_type: 'search',
      source_url: candidate.sourceUrl,
      query: candidate.query,
    }),
  });
}

console.log(JSON.stringify({ discovered: domains.length, verifiedShopify: verified, priority }, null, 2));
