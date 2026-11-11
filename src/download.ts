import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import pc from 'picocolors';
import { trimFile } from './ffmpeg.js';
import { videoToGif, type GifOptions } from './gif.js';

export type Format = 'mp4' | 'mp3' | 'gif';

export interface DownloadOptions {
  url: string;
  format: Format;
  outputDir: string;
  /** Max video height (e.g. 1080). undefined = best available. mp4 only. */
  maxHeight?: number;
  /** MP3 bitrate in kbps. undefined = best VBR. mp3 only. */
  bitrate?: number;
  /** Clip start/end in seconds. */
  start?: number;
  end?: number;
  gif?: GifOptions;
  playlist: boolean;
  ytDlp: string;
  ffmpeg?: string;
}

const PROGRESS = '__URLDL_PROGRESS__';
const DONE = '__URLDL_FILE__';
const TITLE = '__URLDL_TITLE__';

export function buildArgs(o: DownloadOptions, workDir: string): string[] {
  const args = [
    '--newline',
    '--progress',
    '--no-simulate',
    '--no-warnings',
    '--embed-metadata',
    // Chapters get written as an extra text/data track in the MP4, which many
    // upload targets (WhatsApp, Instagram, X, some editors) reject.
    '--no-embed-chapters',
    '-o', '%(title).200B [%(id)s].%(ext)s',
    '-P', workDir,
    '--print', `before_dl:${TITLE}%(title)s`,
    '--print', `after_move:${DONE}%(filepath)s`,
    '--progress-template',
    `download:${PROGRESS}%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s`,
    o.playlist ? '--yes-playlist' : '--no-playlist',
  ];

  if (o.ffmpeg) args.push('--ffmpeg-location', o.ffmpeg);


  if (o.format === 'mp3') {
    args.push(
      '-f', 'ba/b',
      '-x', '--audio-format', 'mp3',
      '--audio-quality', o.bitrate ? `${o.bitrate}K` : '0',
      '--embed-thumbnail',
    );
  } else if (o.format === 'gif') {
    // Video only, capped at 720p: plenty for a GIF and much less to download.
    args.push(
      '-f', 'bv*/b',
      '-S', 'res:720,vcodec:h264,ext:mp4',
      '--remux-video', 'mp4',
    );
  } else {
    // Prefer H.264 + AAC in an MP4 container so the file plays everywhere
    // (QuickTime, iOS, Windows Media Player, editors).
    const res = o.maxHeight ? `res:${o.maxHeight},` : '';
    args.push(
      '-f', 'bv*+ba/b',
      '-S', `${res}vcodec:h264,acodec:aac,ext:mp4:m4a`,
      '--merge-output-format', 'mp4',
      '--remux-video', 'mp4',
    );
  }

  args.push('--', o.url);
  return args;
}

const MAX_NAME = 80;

/**
 * Turn a yt-dlp filename into one that survives upload forms, chat apps and
 * URLs: drop the "[id]" suffix and characters like # & % ? that break pickers.
 */
export function shareableName(name: string): string {
  const ext = path.extname(name);
  let base = name.slice(0, name.length - ext.length);
  base = base
    .replace(/\s*\[[^\]]*\]$/, '') // trailing "[videoId]"
    .normalize('NFKC')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '')
    .replace(/[#%&?*:|"<>\\/{}\[\]^`~$!@=+;]/g, ' ')
    .replace(/\p{Extended_Pictographic}|\p{Cc}|\p{Cf}|[\u{FE00}-\u{FE0F}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/\.{2,}|…/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (base.length > MAX_NAME) base = base.slice(0, MAX_NAME).replace(/[\s.,'-]+\S*$/, '').trim() || base.slice(0, MAX_NAME);
  base = base.replace(/^[\s.-]+|[\s.-]+$/g, '');
  return `${base || 'download'}${ext}`;
}

/** Pick a free path in `dir` for `name`, appending " (1)", " (2)"... on collision. */
function uniquePath(dir: string, name: string): string {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let i = 1; existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

/**
 * Download into a private temp dir inside outputDir, then move finished files out.
 * Isolating each run matters: e.g. an X video has no audio-only stream, so an MP3
 * run would otherwise pick up an existing "<name>.mp4", treat it as its own
 * intermediate file, and delete it after extracting the audio.
 */
export async function download(o: DownloadOptions): Promise<string[]> {
  await mkdir(o.outputDir, { recursive: true });
  const workDir = await mkdtemp(path.join(o.outputDir, '.urldl-'));
  try {
    let produced = await runYtDlp(o, workDir);
    const ffmpeg = o.ffmpeg ?? 'ffmpeg';
    const clipped = o.start !== undefined || o.end !== undefined;
    if (clipped && o.format !== 'gif') {
      for (const file of produced) {
        if (process.stdout.isTTY) process.stdout.write(`\r\x1b[2K  ${pc.dim('Trimming clip...')}`);
        await trimFile(ffmpeg, file, o.start, o.end);
        if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K');
      }
    }
    if (o.format === 'gif') {
      const gifs: string[] = [];
      for (const video of produced) {
        const gif = video.replace(/\.[^.]+$/, '') + '.gif';
        await videoToGif(ffmpeg, video, gif, o.gif ?? { width: 480, fps: 15, maxBytes: 0 }, { start: o.start, end: o.end });
        gifs.push(gif);
      }
      produced = gifs;
    }
    const final: string[] = [];
    for (const file of produced) {
      const dest = uniquePath(o.outputDir, shareableName(path.basename(file)));
      await rename(file, dest);
      final.push(dest);
      console.log(`${pc.green('✔')} ${dest}`);
    }
    return final;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Run yt-dlp, render a progress line, and resolve with the produced file paths. */
function runYtDlp(o: DownloadOptions, workDir: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(o.ytDlp, buildArgs(o, workDir), { stdio: ['ignore', 'pipe', 'pipe'] });
    const files: string[] = [];
    const errors: string[] = [];
    const tty = process.stdout.isTTY;
    let lineOpen = false;

    const clearLine = () => {
      if (lineOpen && tty) process.stdout.write('\r\x1b[2K');
      lineOpen = false;
    };

    const handle = (line: string) => {
      if (line.startsWith(PROGRESS)) {
        const [pct, speed, eta] = line.slice(PROGRESS.length).split('|').map((s) => s.trim());
        const n = Math.max(0, Math.min(100, parseFloat(pct) || 0));
        const width = 30;
        const filled = Math.round((n / 100) * width);
        const bar = pc.green('█'.repeat(filled)) + pc.dim('░'.repeat(width - filled));
        const text = `  ${bar} ${pct.padStart(6)}  ${pc.dim(`${speed}  ETA ${eta}`)}`;
        if (tty) {
          process.stdout.write(`\r\x1b[2K${text}`);
          lineOpen = true;
        }
        if (n >= 100 && tty) {
          process.stdout.write(`\r\x1b[2K  ${pc.dim(o.format === 'mp3' ? 'Converting to MP3...' : 'Processing video...')}`);
        }
      } else if (line.startsWith(TITLE)) {
        clearLine();
        console.log(`${pc.cyan('↓')} ${pc.bold(line.slice(TITLE.length))}`);
      } else if (line.startsWith(DONE)) {
        clearLine();
        files.push(line.slice(DONE.length));
      } else if (line.startsWith('ERROR:')) {
        errors.push(line.replace(/^ERROR:\s*/, ''));
      }
    };

    readline.createInterface({ input: child.stdout }).on('line', handle);
    readline.createInterface({ input: child.stderr }).on('line', handle);

    child.on('error', reject);
    child.on('close', (code) => {
      clearLine();
      if (code === 0) resolve(files);
      else reject(new Error(errors.join('\n') || `yt-dlp exited with code ${code}`));
    });
  });
}
