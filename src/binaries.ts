import { spawnSync } from 'node:child_process';
import { chmod, mkdir, rename, stat, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// ffmpeg-static is CommonJS (module.exports = path); its .d.ts doesn't match under NodeNext.
const ffmpegStatic = createRequire(import.meta.url)('ffmpeg-static') as string | null;

const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const UPDATE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function cacheDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'urldl');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'urldl');
  }
  return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'urldl');
}

/** Name of the standalone yt-dlp release asset for this OS/arch. */
function ytDlpAssetName(): string {
  const { platform, arch } = process;
  if (platform === 'win32') return arch === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe';
  if (platform === 'darwin') return 'yt-dlp_macos';
  if (platform === 'linux') {
    if (arch === 'x64') return 'yt-dlp_linux';
    if (arch === 'arm64') return 'yt-dlp_linux_aarch64';
    if (arch === 'arm') return 'yt-dlp_linux_armv7l';
  }
  throw new Error(`No prebuilt yt-dlp for ${platform}/${arch}. Install yt-dlp yourself and set YTDLP_PATH.`);
}

async function downloadYtDlp(dest: string, log: (msg: string) => void): Promise<void> {
  const asset = ytDlpAssetName();
  log(`Downloading yt-dlp (${asset})...`);
  const res = await fetch(`${RELEASE_BASE}/${asset}`);
  if (!res.ok) throw new Error(`Failed to download yt-dlp: HTTP ${res.status}`);
  const tmp = `${dest}.part`;
  await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  await chmod(tmp, 0o755);
  await rename(tmp, dest);
}

/**
 * Resolve the yt-dlp binary. Order: $YTDLP_PATH, then a managed copy in the
 * user cache dir (downloaded on first run and self-updated weekly).
 * A managed copy is preferred over a system install because distro packages
 * fall behind and YouTube breaks old versions quickly.
 */
export async function getYtDlp(opts: { forceUpdate?: boolean; log: (msg: string) => void }): Promise<string> {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;

  const dir = cacheDir();
  const bin = path.join(dir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  await mkdir(dir, { recursive: true });

  if (!existsSync(bin)) {
    await downloadYtDlp(bin, opts.log);
    return bin;
  }

  const age = Date.now() - (await stat(bin)).mtimeMs;
  if (opts.forceUpdate || age > UPDATE_AFTER_MS) {
    opts.log('Checking for yt-dlp updates...');
    const r = spawnSync(bin, ['-U'], { encoding: 'utf8' });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').pop();
    if (out) opts.log(out);
    // Touch the file so we don't check again for another week.
    const now = new Date();
    await utimes(bin, now, now);
  }
  return bin;
}

/** Resolve ffmpeg: $FFMPEG_PATH, then the bundled ffmpeg-static binary, then PATH. */
export function getFfmpeg(): string | undefined {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (ffmpegStatic && existsSync(ffmpegStatic)) return ffmpegStatic;
  return undefined; // let yt-dlp look on PATH
}
