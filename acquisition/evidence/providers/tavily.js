const TAVILY_URL = 'https://api.tavily.com/search';

function extractDomainConstraint(query) {
  const match = String(query || '').match(
    /\bsite:([a-z0-9.-]+\.[a-z]{2,})\b/i
  );

  return match ? match[1].toLowerCase() : null;
}

function cleanQuery(query) {
  return String(query || '')
    .replace(
      /\bsite:[a-z0-9.-]+\.[a-z]{2,}\b/gi,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHostname(url) {
  try {
    return new URL(url)
      .hostname
      .toLowerCase()
      .replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isAllowedResult(url, domain) {
  if (!url) {
    return false;
  }

  if (!domain) {
    return true;
  }

  const hostname = normalizeHostname(url);

  // Trustpilot site constraint:
  // only accept Trustpilot review pages for the
  // exact requested merchant domain.
  if (hostname !== 'trustpilot.com') {
    return false;
  }

  try {
    const pathname = new URL(url)
      .pathname
      .toLowerCase();

    const expectedPath =
      `/review/${domain}`.toLowerCase();

    return (
      pathname === expectedPath ||
      pathname.startsWith(`${expectedPath}/`)
    );
  } catch {
    return false;
  }
}

export async function searchTavily(
  query,
  {
    apiKey,
    maxResults = 10,
  } = {}
) {
  if (!apiKey) {
    throw new Error(
      'TAVILY_API_KEY is not configured'
    );
  }

  const domain =
    extractDomainConstraint(query);

  const payload = {
    api_key: apiKey,
    query: query,
    search_depth: 'basic',
    topic: 'general',
    max_results: maxResults,
    include_answer: false,
    include_raw_content: false,
  };

  if (domain) {
    payload.include_domains = [domain];
  }

  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const body = await res.text();

  if (!res.ok) {
    throw new Error(
      `Tavily ${res.status}: ${body.slice(0, 400)}`
    );
  }

  if (!body.trim()) {
    return [];
  }

  const data = JSON.parse(body);

  if (!Array.isArray(data.results)) {
    return [];
  }

  return data.results
    .filter((item) =>
      isAllowedResult(item?.url || '', domain)
    )
    .map((item) => ({
      url: item.url || '',
      title: item.title || '',
      description: item.content || '',
      published_date:
        item.published_date || null,
      score:
        typeof item.score === 'number'
          ? item.score
          : null,
    }));
}
