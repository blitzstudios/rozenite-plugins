const pad = (value: number) => String(value).padStart(2, '0');

export function formatTime(ts: number): string {
  const date = new Date(ts);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`;
}

export function summarizeDetails(details: Record<string, unknown> | undefined, limit = 160): string {
  if (!details) return '';
  const text = Object.entries(details)
    .map(([key, value]) => `${key}=${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`)
    .join(' ');
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function matches(query: string, ...fields: (string | number | undefined | null)[]): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return fields.some((field) => field != null && String(field).toLowerCase().includes(needle));
}
