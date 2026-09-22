// RatingSense serverless proxy — /api/recommend
// Proxies the TMDB /movie/{movie_id}/recommendations endpoint so API
// credentials never reach the browser.

const TMDB_RECOMMEND_URL = 'https://api.themoviedb.org/3/movie';

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

  const movieId = (req.query.movie_id || '').trim();

  if (!movieId) {
    return res.status(400).json({ error: 'Missing required query parameter: movie_id' });
  }

  if (!/^\d+$/.test(movieId)) {
    return res.status(400).json({ error: 'movie_id must be a numeric TMDB id.' });
  }

  const page = Math.min(500, Math.max(1, Number(req.query.page) || 1));

  try {
    const url = new URL(`${TMDB_RECOMMEND_URL}/${encodeURIComponent(movieId)}/recommendations`);
    url.searchParams.set('language', 'en-US');
    url.searchParams.set('page', String(page));

    const data = await fetchFromTMDB(url);
    res.status(200).json(data);
  } catch (error) {
    console.error('[/api/recommend]', error.message);
    res.status(500).json({ error: 'Failed to reach TMDB. Please try again later.' });
  }
}
