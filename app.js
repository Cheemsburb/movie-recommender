// RatingSense — client-side logic.
// All TMDB data flows through the local serverless proxy (/api/*);
// credentials never touch this file or the browser.

'use strict';

const resultsContainer = document.getElementById('results');
const statusBox = document.getElementById('status-box');
const heroTitle = document.getElementById('hero-title');
const heroSubtitle = document.getElementById('hero-subtitle');
const heroCount = document.getElementById('hero-count');
const backBtn = document.getElementById('back-btn');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const searchBtnLabel = document.getElementById('search-btn-label');
const searchClear = document.getElementById('search-clear');
const suggestions = document.getElementById('search-suggestions');
const settingsBtn = document.getElementById('settings-btn');
const drawer = document.getElementById('settings-drawer');
const overlay = document.getElementById('overlay');
const drawerClose = document.getElementById('drawer-close');
const doneBtn = document.getElementById('done-btn');
const resetBtn = document.getElementById('reset-btn');
const mInput = document.getElementById('m-input');
const cInput = document.getElementById('c-input');
const preview = document.getElementById('preview');
const previewTitle = document.getElementById('preview-title');
const previewScore = document.getElementById('preview-score');
const previewNote = document.getElementById('preview-note');
const filterAll = document.getElementById('filter-all');
const filterSaved = document.getElementById('filter-saved');
const surpriseBtn = document.getElementById('surprise-btn');
const loadMore = document.getElementById('load-more');
const modalOverlay = document.getElementById('modal-overlay');
const modal = document.getElementById('movie-modal');
const modalClose = document.getElementById('modal-close');
const modalTitle = document.getElementById('modal-title');
const modalMeta = document.getElementById('modal-meta');
const modalGenres = document.getElementById('modal-genres');
const modalOverview = document.getElementById('modal-overview');
const modalRaw = document.getElementById('modal-raw');
const modalTrue = document.getElementById('modal-true');
const modalBreakdown = document.getElementById('modal-breakdown');
const modalSave = document.getElementById('modal-save');
const modalMore = document.getElementById('modal-more');
const modalPoster = document.getElementById('modal-poster');

const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';
const SKELETON_COUNT = 12;
const DEFAULTS = { m: 500, c: 6.5 };
const WATCHLIST_KEY = 'ratingsense:watchlist';

let lastMovies = []; // most recent raw results, kept for param/filter changes
let lastAction = null; // retry hook for failed fetches
let lastFocused = null; // element to return focus to when a surface closes
let currentMovie = null; // the movie currently shown in the modal
let suggestionIndex = -1; // active suggestion index (-1 = none)
let searchTimer = null;

const state = {
  mode: 'discover', // 'discover' | 'search' | 'recommend' | 'saved'
  query: '',
  sourceId: null,
  sourceTitle: '',
  page: 1,
  totalPages: 1,
  filter: 'all', // 'all' | 'saved'
};

// ---- Watchlist (localStorage) ----

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

const watchlist = loadWatchlist();

function persistWatchlist() {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...watchlist]));
}

// ---- Proxy fetches (never call TMDB directly) ----

async function fetchSearch(query, page) {
  const res = await fetch(`/api/search?query=${encodeURIComponent(query)}&page=${page}`);
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  return res.json();
}

async function fetchRecommendations(movieId, page) {
  const res = await fetch(`/api/recommend?movie_id=${encodeURIComponent(movieId)}&page=${page}`);
  if (!res.ok) throw new Error(`Recommendations failed (${res.status})`);
  return res.json();
}

async function fetchPopular(page) {
  const res = await fetch(`/api/popular?page=${page}`);
  if (!res.ok) throw new Error(`Popular fetch failed (${res.status})`);
  return res.json();
}

async function fetchMovie(movieId) {
  const res = await fetch(`/api/movie?movie_id=${encodeURIComponent(movieId)}`);
  if (!res.ok) throw new Error(`Movie fetch failed (${res.status})`);
  return res.json();
}

// ---- Bayesian correction: WR = (v / (v + m)) * R + (m / (v + m)) * C ----

function computeTrueScore(v, r, m, c) {
  const weighted = v / (v + m);
  return weighted * r + (1 - weighted) * c;
}

function applyBayesianCorrection(moviesArray, m, c) {
  return moviesArray
    .map((movie) => {
      const v = Number(movie.vote_count) || 0;
      const r = Number(movie.vote_average) || 0;
      return { ...movie, bayesian_score: computeTrueScore(v, r, m, c) };
    })
    .sort((a, b) => b.bayesian_score - a.bayesian_score);
}

// ---- DOM rendering ----

function setStatus(message, kind) {
  statusBox.textContent = message;
  statusBox.classList.remove('rs-error', 'rs-success');
  statusBox.classList.add(kind === 'success' ? 'rs-success' : 'rs-error');
  statusBox.classList.remove('is-visible');
  void statusBox.offsetWidth;
  statusBox.classList.add('is-visible');
}

function showError(message, retry) {
  if (retry) {
    lastAction = retry;
    statusBox.innerHTML = '';
    const text = document.createTextNode(message + ' ');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rs-banner-action';
    btn.textContent = 'Retry';
    btn.addEventListener('click', () => {
      const action = lastAction;
      lastAction = null;
      action();
    });
    statusBox.appendChild(text);
    statusBox.appendChild(btn);
  } else {
    statusBox.textContent = message;
  }
  statusBox.classList.remove('rs-success');
  statusBox.classList.add('rs-error');
  statusBox.classList.remove('is-visible');
  void statusBox.offsetWidth;
  statusBox.classList.add('is-visible');
}

function showSuccess(message) {
  lastAction = null;
  setStatus(message, 'success');
}

function clearStatus() {
  statusBox.classList.remove('is-visible');
  statusBox.textContent = '';
  statusBox.classList.remove('rs-success', 'rs-error');
  lastAction = null;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value);
  return div.innerHTML;
}

function posterSrc(movie) {
  return movie.poster_path ? `${POSTER_BASE}${movie.poster_path}` : null;
}

function isSaved(movieId) {
  return watchlist.has(String(movieId));
}

function toggleSaved(movieId) {
  const key = String(movieId);
  if (watchlist.has(key)) {
    watchlist.delete(key);
  } else {
    watchlist.add(key);
  }
  persistWatchlist();
  return isSaved(key);
}

function renderSkeletons() {
  const items = [];
  for (let i = 0; i < SKELETON_COUNT; i += 1) {
    items.push(`
      <div class="rs-skeleton-card" aria-hidden="true">
        <div class="rs-skeleton-poster"></div>
        <div class="rs-skeleton-line"></div>
        <div class="rs-skeleton-line"></div>
      </div>
    `);
  }
  resultsContainer.innerHTML = items.join('');
}

function saveButton(movieId) {
  const saved = isSaved(movieId);
  return `
    <button
      type="button"
      class="rs-save-toggle${saved ? ' is-saved' : ''}"
      data-save-id="${movieId}"
      aria-label="${saved ? 'Remove from' : 'Add to'} watchlist"
      aria-pressed="${saved}"
    >${saved ? '★' : '☆'}</button>
  `;
}

function movieCard(movie, index) {
  const poster = posterSrc(movie)
    ? `<img src="${posterSrc(movie)}" alt="${escapeHtml(movie.title)} poster" loading="lazy" />`
    : `<div class="rs-poster-empty">No poster</div>`;

  return `
    <article
      class="rs-card"
      data-movie-id="${movie.id}"
      data-movie-title="${escapeHtml(movie.title)}"
      style="--i:${index}"
      tabindex="0"
      role="button"
      aria-label="Details for ${escapeHtml(movie.title)}"
      title="${escapeHtml(movie.title)}"
    >
      <div class="rs-card-poster">
        <span class="rs-rank">#${index + 1}</span>
        ${saveButton(movie.id)}
        ${poster}
        <span class="rs-score-badge" title="RatingSense true score">${movie.bayesian_score.toFixed(1)}<small>/10</small></span>
      </div>
      <div class="rs-card-body">
        <h3 class="rs-card-title">${escapeHtml(movie.title)}</h3>
        <p class="rs-card-meta">${movie.release_date ? movie.release_date.slice(0, 4) : 'N/A'} · ${(movie.vote_count || 0).toLocaleString()} votes</p>
        <span class="rs-card-cta">More like this &#8594;</span>
      </div>
    </article>
  `;
}

function renderMovieCards(movies) {
  if (!movies.length) {
    const hint = state.filter === 'saved'
      ? 'Save movies by tapping the star on any card.'
      : 'Try a different search, or head back to trending.';
    resultsContainer.innerHTML = `
      <div class="rs-empty">
        <div class="rs-empty-mark" aria-hidden="true">&#8963;</div>
        <p class="rs-empty-title">${state.filter === 'saved' ? 'No saved movies yet' : 'Nothing here yet'}</p>
        <p class="rs-empty-hint">${hint}</p>
      </div>
    `;
    return;
  }

  resultsContainer.innerHTML = movies.map(movieCard).join('');

  // Card body opens the detail modal.
  resultsContainer.querySelectorAll('[data-movie-id]').forEach((card) => {
    const open = () => openMovie(card.dataset.movieId, card.dataset.movieTitle);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });

  // Save toggles are independent of the card click.
  resultsContainer.querySelectorAll('[data-save-id]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const saved = toggleSaved(btn.dataset.saveId);
      btn.classList.toggle('is-saved', saved);
      btn.setAttribute('aria-pressed', String(saved));
      btn.setAttribute('aria-label', `${saved ? 'Remove from' : 'Add to'} watchlist`);
      btn.textContent = saved ? '★' : '☆';
      if (state.filter === 'saved') sortAndRender(lastMovies);
      if (currentMovie && String(currentMovie.id) === String(btn.dataset.saveId)) {
        updateModalSave();
      }
    });
  });
}

// ---- Hero (context-aware) ----

function renderHero(sorted) {
  heroCount.innerHTML = sorted.length
    ? `<strong>${sorted.length}</strong> ${sorted.length === 1 ? 'title' : 'titles'}`
    : 'No titles';

  if (state.mode === 'discover') {
    backBtn.hidden = true;
    heroTitle.textContent = 'Trending now';
    heroSubtitle.textContent = 'Ranked by RatingSense true score';
  } else if (state.mode === 'search') {
    backBtn.hidden = true;
    heroTitle.textContent = `Results for "${state.query}"`;
    heroSubtitle.textContent = 'Ranked by RatingSense true score';
  } else if (state.mode === 'saved') {
    backBtn.hidden = true;
    heroTitle.textContent = 'Saved movies';
    heroSubtitle.textContent = 'Your watchlist, ranked by RatingSense true score';
  } else {
    backBtn.hidden = false;
    heroTitle.textContent = `More like "${state.sourceTitle}"`;
    heroSubtitle.textContent = 'Ranked by RatingSense true score';
  }
}

// ---- State & flow ----

function getParams() {
  return {
    m: Math.max(0, Number(mInput.value) || 0),
    c: Math.min(10, Math.max(0, Number(cInput.value) || 0)),
  };
}

function setBusy(busy) {
  searchBtn.disabled = busy;
  searchBtn.classList.toggle('is-busy', busy);
  searchBtnLabel.textContent = busy ? 'Loading' : 'Search';
}

function filterBySaved(movies) {
  return state.filter === 'saved'
    ? movies.filter((m) => isSaved(m.id))
    : movies;
}

function sortAndRender(movies) {
  const { m, c } = getParams();
  const sorted = applyBayesianCorrection(movies, m, c);
  const visible = filterBySaved(sorted);
  renderHero(visible);
  renderMovieCards(visible);
  updateLoadMore();
  updatePreview();
  updateSurprise();
}

function updateLoadMore() {
  const hasMore = state.page < state.totalPages;
  loadMore.hidden = !hasMore;
  loadMore.disabled = false;
  loadMore.textContent = 'Load more';
}

function applyResults(data, append) {
  const incoming = data.results || [];
  lastMovies = append ? [...lastMovies, ...incoming] : incoming;
  state.page = data.page || 1;
  state.totalPages = data.total_pages || 1;
  sortAndRender(lastMovies);
}

function runDiscover(append = false) {
  const page = append ? state.page + 1 : 1;
  state.mode = 'discover';
  state.query = '';
  state.sourceId = null;
  state.sourceTitle = '';
  if (!append) state.filter = 'all';
  clearStatus();
  setBusy(true);
  if (!append) renderSkeletons();
  else { loadMore.disabled = true; loadMore.textContent = 'Loading…'; }
  syncHash();

  fetchPopular(page)
    .then((data) => applyResults(data, append))
    .catch((err) => {
      showError(err.message || 'Something went wrong while loading trending titles.', () => runDiscover());
      if (!append) { renderHero([]); resultsContainer.innerHTML = ''; }
    })
    .finally(() => setBusy(false));
}

function runSearch(append = false) {
  const query = searchInput.value.trim();
  if (!query && !state.query) {
    showError('Enter a movie title to search.');
    searchInput.focus();
    return;
  }
  const activeQuery = query || state.query;
  const page = append ? state.page + 1 : 1;

  state.mode = 'search';
  state.query = activeQuery;
  state.sourceId = null;
  state.sourceTitle = '';
  if (!append) state.filter = 'all';
  searchInput.value = activeQuery;
  clearStatus();
  setBusy(true);
  hideSuggestions();
  if (!append) renderSkeletons();
  else { loadMore.disabled = true; loadMore.textContent = 'Loading…'; }
  syncHash();

  fetchSearch(activeQuery, page)
    .then((data) => applyResults(data, append))
    .catch((err) => {
      showError(err.message || 'Something went wrong while fetching results.', () => runSearch());
      if (!append) { renderHero([]); resultsContainer.innerHTML = ''; }
    })
    .finally(() => setBusy(false));
}

function runRecommendations(movieId, movieTitle, append = false) {
  const page = append ? state.page + 1 : 1;
  state.mode = 'recommend';
  state.query = '';
  state.sourceId = movieId;
  state.sourceTitle = movieTitle || 'this title';
  if (!append) state.filter = 'all';
  clearStatus();
  setBusy(true);
  if (!append) renderSkeletons();
  else { loadMore.disabled = true; loadMore.textContent = 'Loading…'; }
  syncHash();

  fetchRecommendations(movieId, page)
    .then((data) => applyResults(data, append))
    .catch((err) => {
      showError(err.message || 'Something went wrong while fetching recommendations.', () => runRecommendations(movieId, state.sourceTitle));
      if (!append) { renderHero([]); resultsContainer.innerHTML = ''; }
    })
    .finally(() => setBusy(false));
}

function runSaved() {
  state.mode = 'saved';
  state.filter = 'saved';
  state.query = '';
  state.sourceId = null;
  state.sourceTitle = '';
  clearStatus();
  syncHash();
  sortAndRender(lastMovies);
}

// ---- Live search suggestions ----

function hideSuggestions() {
  suggestions.hidden = true;
  suggestions.innerHTML = '';
  suggestionIndex = -1;
}

function renderSuggestions(results) {
  if (!results.length) {
    hideSuggestions();
    return;
  }
  suggestionIndex = -1;
  suggestions.innerHTML = results.slice(0, 6).map((movie) => `
    <li>
      <button type="button" class="rs-suggestion" data-suggest-id="${movie.id}" data-suggest-title="${escapeHtml(movie.title)}">
        <span>${escapeHtml(movie.title)}</span>
        <span class="rs-suggestion-year">${movie.release_date ? movie.release_date.slice(0, 4) : ''}</span>
      </button>
    </li>
  `).join('');
  suggestions.hidden = false;

  suggestions.querySelectorAll('[data-suggest-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openMovie(btn.dataset.suggestId, btn.dataset.suggestTitle);
      hideSuggestions();
    });
  });
}

function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const query = searchInput.value.trim();
    searchClear.hidden = !query;
    if (query.length < 2) {
      hideSuggestions();
      return;
    }
    try {
      const data = await fetchSearch(query, 1);
      renderSuggestions(data.results || []);
    } catch {
      hideSuggestions();
    }
  }, 250);
}

function moveSuggestion(delta) {
  const items = [...suggestions.querySelectorAll('.rs-suggestion')];
  if (!items.length) return;
  suggestionIndex = Math.max(0, Math.min(items.length - 1, suggestionIndex + delta));
  items.forEach((item, i) => item.classList.toggle('is-active', i === suggestionIndex));
  items[suggestionIndex].scrollIntoView({ block: 'nearest' });
}

// ---- Detail modal ----

function updateModalSave() {
  if (!currentMovie) return;
  const saved = isSaved(currentMovie.id);
  modalSave.textContent = saved ? 'Saved' : 'Save';
  modalSave.classList.toggle('is-saved', saved);
  modalSave.setAttribute('aria-pressed', String(saved));
}

function openMovie(movieId, movieTitle) {
  lastFocused = document.activeElement;
  modalOverlay.hidden = false;
  void modalOverlay.offsetWidth;
  modalOverlay.classList.add('is-open');
  document.body.style.overflow = 'hidden';

  // Show a skeleton title while loading.
  modalTitle.textContent = movieTitle || 'Loading…';
  modalMeta.textContent = '';
  modalGenres.innerHTML = '';
  modalOverview.textContent = '';
  modalRaw.textContent = '…';
  modalTrue.textContent = '…';
  modalBreakdown.textContent = '';
  modalPoster.innerHTML = '';
  updateModalSave();

  fetchMovie(movieId)
    .then((movie) => {
      currentMovie = movie;
      renderModal(movie);
    })
    .catch((err) => {
      currentMovie = { id: movieId, title: movieTitle || 'This title' };
      modalOverview.textContent = err.message || 'Could not load details.';
      updateModalSave();
    })
    .finally(() => modalClose.focus());
}

function renderModal(movie) {
  const { m, c } = getParams();
  const v = Number(movie.vote_count) || 0;
  const r = Number(movie.vote_average) || 0;
  const trueScore = computeTrueScore(v, r, m, c);

  currentMovie = movie;
  modalTitle.textContent = movie.title || 'Untitled';
  modalMeta.textContent = [
    movie.release_date ? movie.release_date.slice(0, 4) : '',
    movie.runtime ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m` : '',
  ].filter(Boolean).join(' · ');

  modalGenres.innerHTML = (movie.genres || []).slice(0, 4)
    .map((g) => `<span class="rs-modal-genre">${escapeHtml(g.name)}</span>`)
    .join('');

  modalOverview.textContent = movie.overview || 'No synopsis available.';

  modalRaw.textContent = r.toFixed(1);
  modalTrue.textContent = trueScore.toFixed(2);

  const poster = movie.poster_path
    ? `<img src="${POSTER_BASE}${movie.poster_path}" alt="${escapeHtml(movie.title)} poster" />`
    : `<div class="rs-poster-empty">No poster</div>`;
  modalPoster.innerHTML = poster;

  modalBreakdown.innerHTML = `
    <strong>How this score works:</strong> the raw average of <strong>${r.toFixed(1)}</strong>
    from <strong>${v.toLocaleString()}</strong> votes is pulled toward the global mean
    <strong>${c.toFixed(1)}</strong> because ${v < m ? 'this title has fewer than' : 'this title has at least'}
    the minimum threshold <strong>${m}</strong> votes.
    <div class="rs-breakdown-formula">
      (${v.toLocaleString()} / (${v.toLocaleString()} + ${m})) × ${r.toFixed(1)}
      + (${m} / (${v.toLocaleString()} + ${m})) × ${c.toFixed(1)}
      = ${trueScore.toFixed(2)}
    </div>
  `;

  updateModalSave();
}

function closeModal() {
  modalOverlay.classList.remove('is-open');
  document.body.style.overflow = '';
  window.setTimeout(() => {
    modalOverlay.hidden = true;
  }, 250);
  if (lastFocused) lastFocused.focus();
}

function trapModalFocus(event) {
  if (event.key !== 'Tab') return;
  const focusables = modal.querySelectorAll('button, [tabindex]:not([tabindex="-1"])');
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// ---- Sensitivity preview ----

function updatePreview() {
  if (!lastMovies.length) {
    preview.hidden = true;
    return;
  }
  const { m, c } = getParams();
  const example = lastMovies[0];
  const v = Number(example.vote_count) || 0;
  const r = Number(example.vote_average) || 0;
  const score = computeTrueScore(v, r, m, c);

  preview.hidden = false;
  previewTitle.textContent = example.title || 'Example title';
  previewScore.textContent = score.toFixed(2);
  previewNote.textContent = `${v.toLocaleString()} votes, raw ${r.toFixed(1)}. As m rises, a low-vote title is pulled harder toward C.`;
}

function updateSurprise() {
  const visible = filterBySaved(applyBayesianCorrection(lastMovies, getParams().m, getParams().c));
  surpriseBtn.disabled = !visible.length;
}

function surpriseMe() {
  const visible = filterBySaved(applyBayesianCorrection(lastMovies, getParams().m, getParams().c));
  if (!visible.length) return;
  const pick = visible[Math.floor(Math.random() * visible.length)];
  openMovie(pick.id, pick.title);
}

// ---- Settings drawer ----

function openDrawer() {
  lastFocused = document.activeElement;
  drawer.hidden = false;
  overlay.hidden = false;
  void drawer.offsetWidth;
  drawer.classList.add('is-open');
  overlay.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  drawerClose.focus();
}

function closeDrawer() {
  drawer.classList.remove('is-open');
  overlay.classList.remove('is-open');
  document.body.style.overflow = '';
  window.setTimeout(() => {
    drawer.hidden = true;
    overlay.hidden = true;
  }, 300);
  if (lastFocused) lastFocused.focus();
}

function resetDefaults() {
  mInput.value = DEFAULTS.m;
  cInput.value = DEFAULTS.c;
  if (lastMovies.length) sortAndRender(lastMovies);
  showSuccess('Settings reset to defaults.');
}

function trapDrawerFocus(event) {
  if (event.key !== 'Tab') return;
  const focusables = drawer.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])');
  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// ---- URL hash sync ----

function syncHash() {
  const parts = [];
  if (state.mode === 'search' && state.query) {
    parts.push(`mode=search`, `q=${encodeURIComponent(state.query)}`);
  } else if (state.mode === 'recommend' && state.sourceId) {
    parts.push(`mode=recommend`, `movie=${state.sourceId}`, `title=${encodeURIComponent(state.sourceTitle || '')}`);
  } else if (state.mode === 'saved') {
    parts.push(`mode=saved`);
  }
  if (state.filter === 'saved') parts.push('filter=saved');

  const hash = parts.length ? `#${parts.join('&')}` : '';
  if (location.hash !== hash) {
    history.replaceState(null, '', hash || location.pathname + location.search);
  }
}

function restoreFromHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const mode = params.get('mode');
  const filter = params.get('filter');
  const q = params.get('q');
  const movieId = params.get('movie');
  const title = params.get('title');

  if (filter === 'saved') state.filter = 'saved';
  else state.filter = 'all';

  if (mode === 'search' && q) {
    state.query = q;
    searchInput.value = q;
    runSearch();
  } else if (mode === 'recommend' && movieId) {
    runRecommendations(movieId, title || 'this title');
  } else if (mode === 'saved') {
    runSaved();
  } else {
    runDiscover();
  }
}

// ---- Events ----

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch();
});

searchInput.addEventListener('input', scheduleSearch);
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveSuggestion(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveSuggestion(-1);
  } else if (event.key === 'Escape') {
    hideSuggestions();
  }
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.hidden = true;
  hideSuggestions();
  searchInput.focus();
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.rs-search-box')) hideSuggestions();
});

backBtn.addEventListener('click', runDiscover);

filterAll.addEventListener('click', () => {
  state.filter = 'all';
  filterAll.classList.add('is-active');
  filterAll.setAttribute('aria-selected', 'true');
  filterSaved.classList.remove('is-active');
  filterSaved.setAttribute('aria-selected', 'false');
  sortAndRender(lastMovies);
  syncHash();
});

filterSaved.addEventListener('click', () => {
  state.filter = 'saved';
  state.mode = 'saved';
  filterSaved.classList.add('is-active');
  filterSaved.setAttribute('aria-selected', 'true');
  filterAll.classList.remove('is-active');
  filterAll.setAttribute('aria-selected', 'false');
  runSaved();
});

surpriseBtn.addEventListener('click', surpriseMe);

loadMore.addEventListener('click', () => {
  if (state.mode === 'search') runSearch(true);
  else if (state.mode === 'recommend') runRecommendations(state.sourceId, state.sourceTitle, true);
  else runDiscover(true);
});

settingsBtn.addEventListener('click', openDrawer);
drawerClose.addEventListener('click', closeDrawer);
doneBtn.addEventListener('click', closeDrawer);
overlay.addEventListener('click', closeDrawer);
resetBtn.addEventListener('click', resetDefaults);

mInput.addEventListener('input', () => {
  if (lastMovies.length) sortAndRender(lastMovies);
});

cInput.addEventListener('input', () => {
  if (lastMovies.length) sortAndRender(lastMovies);
});

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (event) => {
  if (event.target === modalOverlay) closeModal();
});
modalMore.addEventListener('click', () => {
  if (currentMovie) {
    runRecommendations(currentMovie.id, currentMovie.title);
    closeModal();
  }
});
modalSave.addEventListener('click', () => {
  if (!currentMovie) return;
  toggleSaved(currentMovie.id);
  updateModalSave();
  if (state.filter === 'saved') sortAndRender(lastMovies);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (modalOverlay.classList.contains('is-open')) {
      closeModal();
    } else if (drawer.classList.contains('is-open')) {
      closeDrawer();
    }
  }
  if (modalOverlay.classList.contains('is-open')) {
    trapModalFocus(event);
  } else if (drawer.classList.contains('is-open')) {
    trapDrawerFocus(event);
  }
});

window.addEventListener('hashchange', restoreFromHash);

// ---- Boot ----

restoreFromHash();
