// RatingSense — serverless proxy for /api/popular
// Feeds the "Global Leaderboard" view. Credentials stay server-side.

const TMDB_POPULAR_URL = 'https://api.themoviedb.org/3/movie/popular';

async function fetchFromTMDB(url) {
  const headers = {};
  const token = process.env.READ_ACCESS_TOKEN;
  const apiKey = process.env.API_KEY;

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else if (apiKey) {
    url.searchParams.set('api_key', apiKey);
  } else {
    throw new Error('TMDB credentials are missing. Set API_KEY or READ_ACCESS_TOKEN in .env.');
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`TMDB API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const page = Math.min(500, Math.max(1, Number(req.query.page) || 1));

  try {
    const url = new URL(TMDB_POPULAR_URL);
    url.searchParams.set('language', 'en-US');
    url.searchParams.set('page', String(page));

    const data = await fetchFromTMDB(url);
    res.status(200).json(data);
  } catch (error) {
    console.error('[/api/popular]', error.message);
    res.status(500).json({ error: 'Failed to reach TMDB. Please try again later.' });
  }
}
