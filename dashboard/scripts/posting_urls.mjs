import { postingUrl } from '../worker/posting_url.ts';

// Never persist placeholders or insecure links as the application destination. The link kept is the one a person can open
// (worker/posting_url.ts: an Oracle dataset address becomes the career site's own posting page); source_url keeps the dataset's address,
// which is the posting's identity for the duplicate test and the closure rule.
export function safeApplicationUrl(applicationUrl, sourceUrl) {
  for (const value of [applicationUrl, sourceUrl]) {
    if (typeof value !== 'string' || value.length > 2000) continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) return postingUrl(value);
    } catch { /* try the source link */ }
  }
  return null;
}
