const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

export async function braveSearch({ apiKey, query, count = 20 }) {
  if (!apiKey) throw new Error('BRAVE_SEARCH_API_KEY is not set');

  const url = new URL(ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(count, 20)));
  url.searchParams.set('safesearch', 'moderate');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Brave Search failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return (data.web?.results || [])
    .map((item) => ({
      url: item.url,
      title: item.title || '',
      description: item.description || '',
    }))
    .filter((item) => item.url);
}
