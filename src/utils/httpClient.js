const { DEFAULT_HEADERS } = require('../config/constants');

async function fetchWithRetry(url, options = {}, retries = 3) {
  const mergedOptions = {
    headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) },
    ...options
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, mergedOptions);
      if (res.ok) return res;
      if (attempt === retries) return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  return null;
}

async function fetchBare(url, options = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (attempt === retries) return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  return null;
}

// Process concurrent async mapping with worker pool limit
async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

module.exports = {
  fetchWithRetry,
  fetchBare,
  mapConcurrent
};
