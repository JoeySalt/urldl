export type Platform = 'youtube' | 'x';

const HOSTS: Record<string, Platform> = {
  'youtube.com': 'youtube',
  'm.youtube.com': 'youtube',
  'music.youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'x.com': 'x',
  'twitter.com': 'x',
  'mobile.twitter.com': 'x',
  'mobile.x.com': 'x',
};

/** Returns the platform for a supported URL, or throws a readable error. */
export function detectPlatform(input: string): Platform {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`Not a valid URL: ${input}`);
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const platform = HOSTS[host];
  if (!platform) {
    throw new Error(`Unsupported site "${host}". Only YouTube and X/Twitter URLs are supported.`);
  }
  return platform;
}

export function isPlaylistUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.searchParams.has('list');
  } catch {
    return false;
  }
}
