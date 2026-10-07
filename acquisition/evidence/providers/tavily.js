const TAVILY_URL = 'https://api.tavily.com/search';

function extractSiteConstraint(query) {
  const match = String(query || '').match(
    /\bsite:([a-z0-9.-]+\.[a-z]{2,})\b/i
  );

  return match ? match[1].toLowerCase() : null;
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

function isAllowedResult(url, siteConstraint) {
  if (!url) {
    return false;
  }

  if (!siteConstraint) {
    return true;
  }

  const hostname = normalizeHostname(url);

  // Trustpilot special case:
  // site:trustpilot.com/review/xxx
  // Tavily may return regional Trustpilot domains.
  if (siteConstraint.includes('trustpilot.com')) {
    return hostname.endsWith('trustpilot.com');
  }

  return hostname === siteConstraint;
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

  const siteConstraint =
    extractSiteConstraint(query);

  const payload = {
    api_key: apiKey,
    query,
    search_depth: 'advanced',
    topic: 'general',
    max_results: maxResults,
    include_answer: false,
    include_raw_content: false,
  };

  const res = await fetch(
    TAVILY_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

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
      isAllowedResult(
        item?.url || '',
        siteConstraint
      )
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
