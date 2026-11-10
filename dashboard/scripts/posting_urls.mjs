// Never persist placeholders or insecure links as the application destination.
export function safeApplicationUrl(applicationUrl, sourceUrl) {
  for (const value of [applicationUrl, sourceUrl]) {
    if (typeof value !== 'string' || value.length > 2000) continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) return value;
    } catch { /* try the source link */ }
  }
  return null;
}
