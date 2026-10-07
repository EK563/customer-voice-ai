const TAVILY_URL = 'https://api.tavily.com/search';

export async function searchTavily(
  query,
  {
    apiKey,
    maxResults = 10,
  } = {}
) {
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY is not configured');
  }

  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      topic: 'general',
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
    }),
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

  return Array.isArray(data.results)
    ? data.results.map((item) => ({
        url: item.url || '',
        title: item.title || '',
        description: item.content || '',
        published_date:
          item.published_date || null,
        score:
          typeof item.score === 'number'
            ? item.score
            : null,
      }))
    : [];
}
