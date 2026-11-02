// The instructor key (2026-11-02). When the server runs with INSTRUCTOR_KEY set, creating, managing, ending and
// deleting games needs it. The instructor opens the site once as /instructor?key=XXXX (the 15010.ai dashboard
// address redirects there); the key is kept in this browser and the URL is cleaned. Students never see it.
const STORE = 'pricing-game-instructor-key';

export function captureKeyFromUrl() {
  try {
    const url = new URL(window.location.href);
    const key = url.searchParams.get('key');
    if (key) {
      localStorage.setItem(STORE, key);
      url.searchParams.delete('key');
      window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash);
    }
  } catch {}
}

export function getKey() {
  try { return localStorage.getItem(STORE) || ''; } catch { return ''; }
}

export function keyHeaders() {
  const k = getKey();
  return k ? { 'x-instructor-key': k } : {};
}

export function withKey(url) {
  const k = getKey();
  if (!k) return url;
  return url + (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(k);
}
