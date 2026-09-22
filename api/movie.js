// RatingSense serverless proxy — /api/movie
// Proxies the TMDB movie detail endpoint so credentials never reach the browser.

const TMDB_MOVIE_URL = 'https://api.themoviedb.org/3/movie';

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

  try {
    const url = new URL(`${TMDB_MOVIE_URL}/${encodeURIComponent(movieId)}`);
    url.searchParams.set('language', 'en-US');

    const data = await fetchFromTMDB(url);
    res.status(200).json(data);
  } catch (error) {
    console.error('[/api/movie]', error.message);
    res.status(500).json({ error: 'Failed to reach TMDB. Please try again later.' });
  }
}
