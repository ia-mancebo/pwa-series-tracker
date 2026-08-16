import { posterUrl } from './search.js';

export const IMAGE_CACHE_NAME = 'tvtime-images-v1';

const DEFAULT_SIZES = ['w342', 'w500'];

async function mapLimit(items, limit, fn) {
  let index = 0;
  const workers = [];
  const count = Math.min(limit, items.length);
  for (let w = 0; w < count; w += 1) {
    workers.push(
      (async () => {
        while (index < items.length) {
          const i = index;
          index += 1;
          await fn(items[i]);
        }
      })()
    );
  }
  await Promise.all(workers);
}

export async function precacheLibraryPosters(data, { sizes = DEFAULT_SIZES } = {}) {
  if (typeof caches === 'undefined' || !data || !data.catalog) return;
  const urls = [];
  const seen = new Set();
  for (const entry of Object.values(data.catalog)) {
    const poster = entry && entry.poster;
    if (!poster) continue;
    for (const size of sizes) {
      const url = posterUrl(poster, size);
      if (url && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }
  if (!urls.length) return;
  let cache;
  try {
    cache = await caches.open(IMAGE_CACHE_NAME);
  } catch (err) {
    return;
  }
  await mapLimit(urls, 6, async (url) => {
    try {
      const response = await fetch(url, { mode: 'no-cors' });
      if (response) await cache.put(url, response);
    } catch (err) {
      return;
    }
  });
}
