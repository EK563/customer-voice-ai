import {
  REVIEW_QUERIES,
  HISTORICAL_REVIEW_QUERIES,
} from './queries.js';

const limit = Number(
  (
    process.argv.find((a) => a.startsWith('--limit=')) ||
    '--limit=20'
  ).split('=')[1]
);

const CURRENT_DAYS = 90;
const HISTORICAL_DAYS = 365;

const DEBUG = process.argv.includes('--debug');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY;
const braveKey = process.env.BRAVE_SEARCH_API_KEY;

if (!supabaseUrl || !supabaseKey || !braveKey) {
  throw new Error(
    'Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY), and BRAVE_SEARCH_API_KEY'
  );
}

const NEGATIVE_PATTERNS = [
  /disappointed/i,
  /wouldn['’]?t recommend/i,
  /would not recommend/i,
  /never received/i,
  /never arrived/i,
  /did not receive/i,
  /didn['’]?t receive/i,
  /poor quality/i,
  /terrible quality/i,
  /bad quality/i,
  /quality issue/i,
  /quality problem/i,
  /wrong size/i,
  /too small/i,
  /too large/i,
  /too big/i,
  /late delivery/i,
  /late shipping/i,
  /shipping.*(long|slow|late)/i,
  /customer service.*(bad|poor|terrible|awful|unhelpful)/i,
  /refund.*(never|not|still|didn['’]?t|did not)/i,
  /not as described/i,
  /not worth/i,
  /waste of money/i,
  /avoid (this|them|this store|this company)/i,
];

const CUSTOMER_CONTEXT = [
  /\bi\b/i,
  /\bmy\b/i,
  /\bwe\b/i,
  /\bour\b/i,
  /\bi['’]?ve\b/i,
  /\bordered\b/i,
  /\bbought\b/i,
  /\bpurchased\b/i,
  /\breceived\b/i,
  /\bpackage\b/i,
  /\border\b/i,
  /\bdelivery\b/i,
  /\bshipment\b/i,
  /\bcustomer\b/i,
  /\breview\b/i,
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

function normalizeDomain(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\/$/, '')
    .trim();
}

function hostOf(value) {
  try {
    return new URL(value).hostname
      .toLowerCase()
      .replace(/^www\./, '');
  } catch {
    return '';
  }
}

function pathOf(value) {
  try {
    return new URL(value).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function isOwnedByMerchant(host, merchantDomain) {
  const merchant = normalizeDomain(merchantDomain);

  return (
    !!merchant &&
    (host === merchant || host.endsWith(`.${merchant}`))
  );
}

function isThirdParty(host, merchantDomain) {
  if (!host || isOwnedByMerchant(host, merchantDomain)) {
    return false;
  }

  return THIRD_PARTY_HOSTS.some(
    (allowed) =>
      host === allowed ||
      host.endsWith(`.${allowed}`)
  );
}

function isBadUrl(url, title = '') {
  const lowerUrl = String(url || '').toLowerCase();
  const lowerTitle = String(title || '').toLowerCase();

  if (
    BAD_PATH_PARTS.some((part) =>
      lowerUrl.includes(part)
    )
  ) {
    return true;
  }

  if (
    /shipping policy|return policy|refund policy|privacy policy|terms of service|faq|help center|product page/i.test(
      lowerTitle
    )
  ) {
    return true;
  }

  return false;
}

function brandFromProspect(prospect) {
  const domain = normalizeDomain(prospect.domain);

  const raw = String(
    prospect.store_name || domain
  )
    .replace(
      /&ndash;|&mdash;|&amp;|&quot;|&#39;|&apos;/gi,
      ' '
    )
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const stem = domain
    .split('.')[0]
    .replace(/[^a-z0-9]/gi, '');

  if (
    stem &&
    raw.toLowerCase().includes(stem.toLowerCase())
  ) {
    return stem;
  }

  const cleaned = raw
    .replace(
      /\s*[|–—-]\s*(shopify|official|online store|store|clothing supplier|supplier).*$/i,
      ''
    )
    .replace(
      /^start a dropshipping business usa\s*/i,
      ''
    )
    .trim();

  return cleaned.slice(0, 80) || stem || domain;
}

function merchantIdentityTokens(prospect) {
  const domain = normalizeDomain(prospect.domain);
  const brand = brandFromProspect(prospect);

  const stop = new Set([
    'the',
    'and',
    'shop',
    'store',
    'online',
    'official',
    'company',
    'business',
    'clothing',
    'supplier',
    'dropshipping',
    'usa',
  ]);

  const tokens = `${brand} ${domain}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(
      (x) => x.length >= 4 && !stop.has(x)
    );

  return [...new Set(tokens)];
}

function identityMatch(result, prospect) {
  const resultHost = hostOf(result.url);
  const merchantDomain = normalizeDomain(
    prospect.domain
  );

  if (!resultHost || !merchantDomain) {
    return {
      matched: false,
      strength: 0,
      reason: 'missing_domain',
      tokenHits: [],
    };
  }

  const titleText =
    `${result.title || ''} ${result.description || ''}`
      .toLowerCase();

  if (
    resultHost === merchantDomain ||
    resultHost.endsWith(`.${merchantDomain}`)
  ) {
    return {
      matched: true,
      strength: 3,
      reason: 'exact_merchant_domain',
      tokenHits: [],
    };
  }

  const tokens = merchantIdentityTokens(prospect);
  const tokenHits = tokens.filter((token) =>
    titleText.includes(token)
  );

  if (tokenHits.length >= 2) {
    return {
      matched: true,
      strength: 3,
      reason: 'multiple_brand_tokens',
      tokenHits,
    };
  }

  if (tokenHits.length === 1) {
    return {
      matched: true,
      strength: 2,
      reason: 'single_brand_token',
      tokenHits,
    };
  }

  return {
    matched: false,
    strength: 0,
    reason: 'merchant_identity_not_confirmed',
    tokenHits: [],
  };
}

function extractDate(result) {
  const candidates = [
    result?.deep_results?.review?.datePublished,
    result?.deep_results?.review?.dateCreated,
    result?.deep_results?.review?.datePosted,
    result?.deep_results?.article?.datePublished,
    result?.deep_results?.article?.dateCreated,
    result?.page_age,
  ];

  for (const value of candidates) {
    if (!value) continue;

    const d = new Date(value);

    if (!Number.isNaN(d.getTime())) {
      return {
        date: d.toISOString().slice(0, 10),
        source: 'structured_or_page_age',
      };
    }
  }

  const text =
    `${result?.title || ''} ${result?.description || ''}`;

  const isoMatch = text.match(
    /\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/
  );

  if (isoMatch) {
    const d = new Date(
      `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, '0')}-${String(
        isoMatch[3]
      ).padStart(2, '0')}`
    );

    if (!Number.isNaN(d.getTime())) {
      return {
        date: d.toISOString().slice(0, 10),
        source: 'text',
      };
    }
  }

  const monthMatch = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(0?[1-9]|[12]\d|3[01]),?\s+(20\d{2})\b/i
  );

  if (monthMatch) {
    const d = new Date(
      `${monthMatch[1]} ${monthMatch[2]}, ${monthMatch[3]}`
    );

    if (!Number.isNaN(d.getTime())) {
      return {
        date: d.toISOString().slice(0, 10),
        source: 'text',
      };
    }
  }

  return null;
}

function classifyRecency(dateValue) {
  if (!dateValue) {
    return {
      usable: false,
      recencyClass: 'undated',
      ageDays: null,
    };
  }

  const date = new Date(`${dateValue}T00:00:00Z`);
  const today = new Date();

  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );

  const ageDays = Math.floor(
    (todayUtc - date.getTime()) / 86400000
  );

  if (ageDays < 0) {
    return {
      usable: false,
      recencyClass: 'future_or_invalid',
      ageDays,
    };
  }

  if (ageDays <= CURRENT_DAYS) {
    return {
      usable: true,
      recencyClass: 'current',
      painType: 'current_pain',
      ageDays,
    };
  }

  if (ageDays <= HISTORICAL_DAYS) {
    return {
      usable: true,
      recencyClass: 'historical',
      painType: 'historical_pain',
      ageDays,
    };
  }

  return {
    usable: true,
    recencyClass: 'too_old',
    painType: 'historical_signal',
    ageDays,
  };
}

function painCategory(text) {
  const t = String(text || '').toLowerCase();

  if (
    /wrong size|too small|too large|sizing|size|fit/.test(t)
  ) {
    return 'sizing';
  }

  if (
    /late delivery|late shipping|never received|never arrived|shipping|delivery/.test(
      t
    )
  ) {
    return 'delivery';
  }

  if (
    /poor quality|terrible quality|bad quality|quality/.test(t)
  ) {
    return 'quality';
  }

  if (
    /customer service|unhelpful|bad service|poor service/.test(
      t
    )
  ) {
    return 'customer_service';
  }

  if (/not as described/.test(t)) {
    return 'description';
  }

  if (/not worth|waste of money|avoid/.test(t)) {
    return 'value';
  }

  return 'other';
}

function negativeMatches(text) {
  return NEGATIVE_PATTERNS
    .filter((pattern) => pattern.test(text))
    .map((pattern) => pattern.source);
}

function contextHits(text) {
  return CUSTOMER_CONTEXT.filter((pattern) =>
    pattern.test(text)
  ).length;
}

async function sb(path, options = {}) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    }
  );

  const body = await res.text();

  if (!res.ok) {
    throw new Error(`${res.status} ${body}`);
  }

  if (res.status === 204 || !body) {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch {
    return [];
  }
}

async function brave(query, freshness = null) {
  const u = new URL(
    'https://api.search.brave.com/res/v1/web/search'
  );

  u.searchParams.set('q', query);
  u.searchParams.set('count', '10');

  if (freshness) {
    u.searchParams.set('freshness', freshness);
  }

  const res = await fetch(u, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': braveKey,
    },
  });

  const body = await res.text();

  if (!res.ok) {
    throw new Error(
      `Brave ${res.status}: ${body.slice(0, 300)}`
    );
  }

  if (!body.trim()) return [];

  const data = JSON.parse(body);

  return Array.isArray(data.web?.results)
    ? data.web.results
    : [];
}

function dateRange(daysAgoStart, daysAgoEnd) {
  const now = new Date();

  const start = new Date(now);
  start.setUTCDate(
    start.getUTCDate() - daysAgoStart
  );

  const end = new Date(now);
  end.setUTCDate(
    end.getUTCDate() - daysAgoEnd
  );

  const fmt = (d) =>
    d.toISOString().slice(0, 10);

  return `${fmt(end)}to${fmt(start)}`;
}

async function main() {
  const candidateLimit = Math.min(
    Math.max(limit * 10, 20),
    100
  );

  const prospects = await sb(
    `prospects?select=*&status=in.(qualified,priority)&order=qualification_score.desc&limit=${candidateLimit}`
  );

  let researched = 0;
  let currentSignals = 0;
  let historicalSignals = 0;
  let recurrenceSignals = 0;
  let queriesRun = 0;
  let candidates = 0;

  for (const prospect of prospects || []) {
    if (researched >= limit) {
      break;
    }

    const merchantDomain = normalizeDomain(
      prospect.domain
    );

    const existing = await sb(
      `prospect_signals?select=id&prospect_id=eq.${encodeURIComponent(
        prospect.id
      )}&signal_type=eq.customer_pain&limit=1`
    );

    if (existing?.length) {
      continue;
    }

    const brand = brandFromProspect(prospect);

    const currentQueries = REVIEW_QUERIES(
      brand,
      merchantDomain
    );

    const historicalQueries =
      HISTORICAL_REVIEW_QUERIES(
        brand,
        merchantDomain
      );

    const found = [];
    const seen = new Set();

    async function runQueries(
      queries,
      freshness,
      researchClass
    ) {
      for (const query of queries) {
        let results = [];

        try {
          results = await brave(
            query,
            freshness
          );
        } catch (error) {
          console.error(
            `Brave failed for ${merchantDomain}: ${error.message}`
          );
          continue;
        }

        queriesRun++;

        if (DEBUG) {
          console.log(JSON.stringify({
            debug: 'brave_results',
            merchantDomain,
            researchClass,
            freshness,
            query,
            resultCount: results.length,
            results: results.slice(0, 10).map((r) => ({
              url: r?.url || null,
              title: r?.title || '',
              description: (r?.description || '').slice(0, 300),
              page_age: r?.page_age || null,
              deep_results: r?.deep_results
                ? Object.keys(r.deep_results)
                : [],
            })),
          }, null, 2));
        }

        for (const result of results) {
          if (!result?.url) continue;

          if (seen.has(result.url)) continue;

          seen.add(result.url);

          const host = hostOf(result.url);
          const text =
            `${result.title || ''} ${
              result.description || ''
            }`
              .replace(/\s+/g, ' ')
              .trim();

          if (!host || !text) continue;

          if (
            isOwnedByMerchant(
              host,
              merchantDomain
            )
          ) {
            continue;
          }

          if (
            isBadUrl(
              result.url,
              result.title
            )
          ) {
            continue;
          }

          if (
            !isThirdParty(
              host,
              merchantDomain
            )
          ) {
            continue;
          }

          const identity =
            identityMatch(
              result,
              prospect
            );

          if (!identity.matched) {
            continue;
          }

          const negative =
            negativeMatches(text);

          if (!negative.length) {
            continue;
          }

          const customerContext =
            contextHits(text);

          if (customerContext < 1) {
            continue;
          }

          const dateInfo =
            extractDate(result);

          const recency =
            classifyRecency(
              dateInfo?.date || null
            );

          if (!recency.usable) {
            continue;
          }

          const category =
            painCategory(text);

          if (DEBUG) {
            console.log(JSON.stringify({
              debug: 'accepted_evidence',
              merchantDomain,
              researchClass,
              url: result.url,
              title: result.title || '',
              host,
              identity,
              negative,
              customerContext,
              dateInfo,
              recency,
              category,
            }, null, 2));
          }

          found.push({
            url: result.url,
            title: result.title || '',
            description:
              result.description || '',
            host,
            text,
            negative,
            customerContext,
            identity,
            dateInfo,
            recency,
            category,
            researchClass,
          });

          candidates++;
        }
      }
    }

    const currentFreshness =
      dateRange(0, CURRENT_DAYS);

    const historicalFreshness =
      dateRange(
        HISTORICAL_DAYS,
        CURRENT_DAYS + 1
      );

    await runQueries(
      currentQueries,
      currentFreshness,
      'current_search'
    );

    await runQueries(
      historicalQueries,
      historicalFreshness,
      'historical_search'
    );

    const deduped = [];
    const fingerprints = new Set();

    for (const item of found) {
      const fingerprint = [
        item.host,
        item.category,
        item.recency.recencyClass,
        item.description
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .slice(0, 220),
      ].join('|');

      if (fingerprints.has(fingerprint)) {
        continue;
      }

      fingerprints.add(fingerprint);
      deduped.push(item);
    }

    const current = deduped.filter(
      (x) =>
        x.recency.painType ===
        'current_pain'
    );

    const historical = deduped.filter(
      (x) =>
        x.recency.painType ===
          'historical_pain' ||
        x.recency.painType ===
          'historical_signal'
    );

    const currentCategories =
      new Set(
        current.map(
          (x) => x.category
        )
      );

    const historicalCategories =
      new Set(
        historical.map(
          (x) => x.category
        )
      );

    const recurrenceCategories =
      [...currentCategories].filter(
        (category) =>
          category !== 'other' &&
          historicalCategories.has(
            category
          )
      );

    const hasRecurrence =
      recurrenceCategories.length > 0;

    for (const item of deduped.slice(
      0,
      12
    )) {
      const isCurrent =
        item.recency.painType ===
        'current_pain';

      const recurrence =
        isCurrent &&
        historicalCategories.has(
          item.category
        );

      const confidence = Math.min(
        95,
        45 +
          Math.min(
            25,
            item.negative.length * 8
          ) +
          Math.min(
            15,
            item.customerContext * 3
          ) +
          (item.identity.strength >= 3
            ? 10
            : item.identity.strength >= 2
              ? 5
              : 0)
      );

      let signalType =
        item.recency.painType;

      let signalValue =
        item.recency.painType;

      if (
        recurrence &&
        item.recency.painType ===
          'current_pain'
      ) {
        signalValue =
          'recent_recurrence';

        recurrenceSignals++;
      }

      if (
        item.recency.painType ===
        'current_pain'
      ) {
        currentSignals++;
      } else {
        historicalSignals++;
      }

      await sb(
        'prospect_signals',
        {
          method: 'POST',
          headers: {
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            prospect_id:
              prospect.id,
            signal_type:
              'customer_pain',
            signal_value:
              signalValue,
            confidence,
            evidence_url:
              item.url,
            evidence_text:
              `${item.title} — ${item.description}`.slice(
                0,
                1200
              ),
            metadata: {
              evidenceVersion:
                'v5',
              source:
                'brave_search_v5',
              sourceHost:
                item.host,
              thirdParty: true,
              identityReason:
                item.identity.reason,
              identityTokenHits:
                item.identity.tokenHits,
              painCategory:
                item.category,
              negativeEvidenceCount:
                item.negative.length,
              customerContextHits:
                item.customerContext,
              evidenceDate:
                item.dateInfo?.date ||
                null,
              evidenceDateSource:
                item.dateInfo?.source ||
                null,
              ageDays:
                item.recency.ageDays,
              recencyClass:
                item.recency.recencyClass,
              painType:
                item.recency.painType,
              researchClass:
                item.researchClass,
              recentRecurrence:
                recurrence,
              recurrenceCategory:
                recurrence
                  ? item.category
                  : null,
              recurrenceCategories:
                recurrenceCategories,
            },
          }),
        }
      );
    }

    if (DEBUG) {
      console.log(JSON.stringify({
        debug: 'evidence_summary',
        merchantDomain,
        brand,
        found: found.length,
        deduped: deduped.length,
        current: current.length,
        historical: historical.length,
        recurrenceCategories,
        currentFreshness,
        historicalFreshness,
      }, null, 2));
    }

    const metadata = {
      ...(prospect.metadata || {}),
      evidenceResearch: {
        researchedAt:
          new Date().toISOString(),
        evidenceVersion: 'v5',
        source: 'brave_search_v5',
        currentWindowDays:
          CURRENT_DAYS,
        historicalWindowDays:
          HISTORICAL_DAYS,
        signalCount:
          deduped.length,
        currentPainCount:
          current.length,
        historicalPainCount:
          historical.length,
        recentRecurrence:
          hasRecurrence,
        recurrenceCategories,
        candidateCount:
          found.length,
      },
    };

    await sb(
      `prospects?id=eq.${encodeURIComponent(
        prospect.id
      )}`,
      {
        method: 'PATCH',
        headers: {
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          status: current.length
            ? 'researched'
            : 'qualified',
          metadata,
          updated_at:
            new Date().toISOString(),
        }),
      }
    );

    researched++;
  }

  console.log(
    JSON.stringify(
      {
        researched,
        currentSignals,
        historicalSignals,
        recurrenceSignals,
        queriesRun,
        candidates,
        evidenceVersion: 'v5',
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
