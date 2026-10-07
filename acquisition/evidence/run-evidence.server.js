import { PAIN_QUERIES } from './queries.js';

const limit = Number(
  (process.argv.find((a) => a.startsWith('--limit=')) || '--limit=20').split('=')[1]
);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const braveKey = process.env.BRAVE_SEARCH_API_KEY;

if (!supabaseUrl || !supabaseKey || !braveKey) {
  throw new Error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY), and BRAVE_SEARCH_API_KEY');
}

const NEGATIVE_PATTERNS = [
  /i\s+(?:was|am)\s+(?:very\s+)?disappointed/i,
  /very\s+disappoint(?:ed|ing)/i,
  /wouldn['’]?t\s+recommend/i,
  /would\s+not\s+recommend/i,
  /never\s+(?:received|arrived)/i,
  /did\s+not\s+(?:receive|arrive)/i,
  /didn['’]?t\s+(?:receive|arrive)/i,
  /arrived\s+(?:damaged|broken|late)/i,
  /poor\s+quality/i,
  /terrible\s+quality/i,
  /bad\s+quality/i,
  /quality\s+(?:issue|issues|problem|problems)/i,
  /wrong\s+size/i,
  /too\s+(?:small|large|big)/i,
  /late\s+(?:delivery|shipping)/i,
  /shipping\s+(?:took|was|is)\s+(?:too\s+)?(?:long|slow|late)/i,
  /customer\s+service\s+(?:was|is|has\s+been)\s+(?:terrible|awful|bad|poor|horrible|unhelpful)/i,
  /(?:terrible|awful|bad|poor|horrible)\s+customer\s+service/i,
  /refund\s+(?:never|not|still|hasn['’]?t)/i,
  /issue\s+with\s+(?:my|the|an|a)\s+(?:order|purchase|package|product|item|delivery|shipping)/i,
  /problem\s+with\s+(?:my|the|an|a)\s+(?:order|purchase|package|product|item|delivery|shipping)/i,
  /not\s+as\s+described/i,
  /not\s+worth\s+(?:it|the\s+(?:money|price))/i,
  /waste\s+of\s+money/i,
  /avoid\s+(?:this|them|this\s+store|this\s+company)/i,
  /scam(?:my)?/i,
];

const CUSTOMER_CONTEXT = [
  /\bi\b/i,
  /\bmy\b/i,
  /\bwe\b/i,
  /\bour\b/i,
  /\bi['’]?ve\b/i,
  /\bi\s+(?:ordered|bought|purchased|received|paid)/i,
  /\bmy\s+(?:order|package|purchase|item|product|money)/i,
  /\bpackage\b/i,
  /\border\b/i,
  /\bpurchased\b/i,
  /\bordered\b/i,
  /\breceived\b/i,
];

const THIRD_PARTY_HOSTS = [
  'trustpilot.com',
  'reddit.com',
  'yelp.com',
  'bbb.org',
  'sitejabber.com',
  'complaintsboard.com',
  'pissedconsumer.com',
  'reviews.io',
  'judge.me',
  'yotpo.com',
  'loox.io',
  'stamped.io',
  'okendo.io',
];

const BAD_PATH_PARTS = [
  '/products/',
  '/product/',
  '/collections/',
  '/collection/',
  '/pages/shipping',
  '/pages/returns',
  '/pages/refund',
  '/pages/return',
  '/shipping-policy',
  '/return-policy',
  '/refund-policy',
  '/privacy-policy',
  '/terms-of-service',
  '/terms-and-conditions',
  '/policies/',
  '/faq',
  '/help',
  '/blogs/',
  '/blog/',
];

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeDomain(value) {
  return String(value || '').toLowerCase().replace(/^www\./, '').replace(/\/$/, '');
}

function isThirdParty(host, merchantDomain) {
  const merchant = normalizeDomain(merchantDomain);
  if (!host || host === merchant || host.endsWith(`.${merchant}`)) return false;
  return THIRD_PARTY_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function isBadUrl(url, title = '') {
  const lowerUrl = String(url || '').toLowerCase();
  const lowerTitle = String(title || '').toLowerCase();
  if (BAD_PATH_PARTS.some((part) => lowerUrl.includes(part))) return true;
  if (/shipping policy|return policy|refund policy|privacy policy|terms of service|faq|help center|product page/i.test(lowerTitle)) return true;
  return false;
}

function matchedNegativeTerms(text) {
  return NEGATIVE_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}

function customerContextHits(text) {
  return CUSTOMER_CONTEXT.filter((pattern) => pattern.test(text)).length;
}

async function sb(path, options = {}) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${body}`);
  if (res.status === 204 || !body) return null;
  try { return JSON.parse(body); } catch { return []; }
}

async function brave(q) {
  const u = new URL('https://api.search.brave.com/res/v1/web/search');
  u.searchParams.set('q', q);
  u.searchParams.set('count', '10');
  const res = await fetch(u, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': braveKey },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Brave ${res.status}: ${body.slice(0, 300)}`);
  if (!body.trim()) return [];
  let data;
  try { data = JSON.parse(body); } catch { return []; }
  return Array.isArray(data.web?.results)
    ? data.web.results.map((x) => ({ url: x.url, title: x.title, description: x.description }))
    : [];
}

async function main() {
  const prospects = await sb(
    `prospects?select=*&status=in.(qualified,priority)&order=qualification_score.desc&limit=${Math.max(1, Math.min(limit, 100))}`
  );

  let researched = 0;
  let signals = 0;
  let queriesRun = 0;
  let candidates = 0;

  for (const p of prospects || []) {
    const existing = await sb(
      `prospect_signals?select=id&prospect_id=eq.${encodeURIComponent(p.id)}&signal_type=eq.customer_pain&limit=1`
    );
    if (existing?.length) continue;

    const merchantDomain = normalizeDomain(p.domain);
    const seen = new Set();
    const found = [];

    const brand = String(p.store_name || merchantDomain)
      .replace(/\s*\|.*$/, '')
      .replace(/\s+Help Center.*$/i, '')
      .trim();

    const queries = [
      ...PAIN_QUERIES.map((term) => `"${brand}" ${term}`),
      ...PAIN_QUERIES.slice(0, 6).map((term) => `site:reddit.com "${brand}" ${term}`),
      ...PAIN_QUERIES.slice(0, 6).map((term) => `site:trustpilot.com "${brand}" ${term}`),
      ...PAIN_QUERIES.slice(0, 4).map((term) => `site:yelp.com "${brand}" ${term}`),
    ];

    for (const query of queries) {
      let results = [];
      try {
        results = await brave(query);
      } catch (error) {
        console.error(`Brave failed for ${merchantDomain}: ${error.message}`);
        continue;
      }
      queriesRun++;

      for (const r of results) {
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        const host = hostOf(r.url);
        const text = `${r.title || ''} ${r.description || ''}`.trim();
        if (!host || !text || isBadUrl(r.url, r.title)) continue;

        const negative = matchedNegativeTerms(text);
        const contextHits = customerContextHits(text);
        const thirdParty = isThirdParty(host, merchantDomain);

        if (!negative.length || contextHits < 1 || !thirdParty) continue;

        candidates++;
        found.push({
          url: r.url,
          title: r.title || '',
          description: r.description || '',
          host,
          negative,
          contextHits,
          thirdParty,
        });
      }
    }

    const deduped = [];
    const fingerprints = new Set();
    for (const item of found) {
      const fp = `${item.host}|${item.negative.slice().sort().join('|')}|${item.description.toLowerCase().replace(/\s+/g, ' ').slice(0, 220)}`;
      if (fingerprints.has(fp)) continue;
      fingerprints.add(fp);
      deduped.push(item);
    }

    for (const item of deduped.slice(0, 8)) {
      const confidence = Math.min(
        95,
        55 + Math.min(item.negative.length * 8, 24) + Math.min(item.contextHits * 3, 12) + 10
      );

      await sb('prospect_signals', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          prospect_id: p.id,
          signal_type: 'customer_pain',
          signal_value: 'third_party_customer_pain',
          confidence,
          evidence_url: item.url,
          evidence_text: `${item.title} — ${item.description}`.slice(0, 1000),
          metadata: {
            title: item.title,
            source: 'brave_search_v2',
            sourceHost: item.host,
            thirdParty: true,
            negativeEvidenceCount: item.negative.length,
            customerContextHits: item.contextHits,
          },
        }),
      });
      signals++;
    }

    const metadata = {
      ...(p.metadata || {}),
      evidenceResearch: {
        researchedAt: new Date().toISOString(),
        signalCount: deduped.slice(0, 8).length,
        candidateCount: found.length,
        source: 'brave_search_v2',
      },
    };

    await sb(`prospects?id=eq.${encodeURIComponent(p.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: deduped.length ? 'researched' : 'qualified',
        metadata,
        updated_at: new Date().toISOString(),
      }),
    });

    researched++;
  }

  console.log(JSON.stringify({ researched, signals, queriesRun, candidates }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
