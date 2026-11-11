#!/usr/bin/env node
import path from 'node:path';
import { Command, Option } from 'commander';
import { confirm, input, select } from '@inquirer/prompts';
import pc from 'picocolors';
import { getFfmpeg, getYtDlp } from './binaries.js';
import { defaultOutputDir } from './dirs.js';
import { download, type Format } from './download.js';
import type { GifOptions } from './gif.js';
import { formatTime, parseTime } from './time.js';
import { detectPlatform, isPlaylistUrl } from './url.js';

interface CliOptions {
  format: Format;
  audio?: boolean;
  gif?: boolean;
  start?: string;
  end?: string;
  gifWidth: string;
  gifFps: string;
  maxMb: string;
  quality: string;
  bitrate?: string;
  output?: string;
  playlist?: boolean;
  update?: boolean;
}

const log = (msg: string) => console.log(pc.dim(msg));

/** GIFs without an end time stop after this many seconds, so they stay a sane size. */
const GIF_DEFAULT_SECONDS = 15;

interface Job {
  format: Format;
  maxHeight?: number;
  bitrate?: number;
  start?: number;
  end?: number;
  gif?: GifOptions;
  outputDir: string;
  playlist: boolean;
}

function positiveInt(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid ${name} "${value}".`);
  return n;
}

/** Validate a clip range, applying the GIF default length when no end was given. */
function clipRange(format: Format, start?: number, end?: number): { start?: number; end?: number } {
  if (format === 'gif' && end === undefined) {
    end = (start ?? 0) + GIF_DEFAULT_SECONDS;
    log(`GIF: using ${formatTime(start ?? 0)}–${formatTime(end)} (pass --end for a different length)`);
  }
  if (start !== undefined && end !== undefined && end <= start) {
    throw new Error(`End time (${formatTime(end)}) must be after start time (${formatTime(start)}).`);
  }
  return { start, end };
}

function parseQuality(q: string): number | undefined {
  if (q === 'best') return undefined;
  const n = parseInt(q.replace(/p$/i, ''), 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid quality "${q}". Use e.g. 1080, 720p or best.`);
  return n;
}

async function runOne(
  url: string,
  o: Job,
  bins: { ytDlp: string; ffmpeg?: string },
): Promise<boolean> {
  try {
    const platform = detectPlatform(url);
    log(`${platform === 'youtube' ? 'YouTube' : 'X'} → ${o.format.toUpperCase()}`);
    const files = await download({ url, ...o, ...bins });
    if (files.length === 0) console.log(pc.yellow('Nothing was downloaded (no media found at that URL?).'));
    return true;
  } catch (err) {
    console.error(`${pc.red('✖')} ${(err as Error).message}`);
    return false;
  }
}

async function interactive(bins: { ytDlp: string; ffmpeg?: string }, gif: GifOptions, outputOverride?: string): Promise<void> {
  console.log(pc.bold('\nurldl') + pc.dim(' — YouTube / X downloader. Ctrl+C to quit.\n'));
  for (;;) {
    const url = await input({
      message: 'URL:',
      validate: (v) => {
        try {
          detectPlatform(v);
          return true;
        } catch (e) {
          return (e as Error).message;
        }
      },
    });

    const format = await select<Format>({
      message: 'Format:',
      choices: [
        { name: 'MP4 (video)', value: 'mp4' },
        { name: 'MP3 (audio only)', value: 'mp3' },
        { name: 'GIF (short clip, no sound)', value: 'gif' },
      ],
    });

    let maxHeight: number | undefined;
    let bitrate: number | undefined;
    if (format === 'mp4') {
      maxHeight = await select<number | undefined>({
        message: 'Quality:',
        choices: [
          { name: 'Best available', value: undefined },
          { name: '1080p', value: 1080 },
          { name: '720p', value: 720 },
          { name: '480p', value: 480 },
        ],
      });
    } else if (format === 'mp3') {
      bitrate = await select<number | undefined>({
        message: 'Bitrate:',
        choices: [
          { name: 'Best (VBR)', value: undefined },
          { name: '320 kbps', value: 320 },
          { name: '192 kbps', value: 192 },
          { name: '128 kbps', value: 128 },
        ],
      });
    }

    let start: number | undefined;
    let end: number | undefined;
    const timeOrBlank = (v: string) => {
      if (!v.trim()) return true;
      try {
        parseTime(v);
        return true;
      } catch (e) {
        return (e as Error).message;
      }
    };
    if (format === 'gif') {
      const s = await input({ message: 'Start time (e.g. 1:23, blank = 0:00):', validate: timeOrBlank });
      start = s.trim() ? parseTime(s) : undefined;
      const e = await input({
        message: `End time (blank = ${GIF_DEFAULT_SECONDS}s after start):`,
        validate: (v) => {
          const ok = timeOrBlank(v);
          if (ok !== true || !v.trim()) return ok;
          return parseTime(v) > (start ?? 0) || 'End time must be after the start time.';
        },
      });
      end = e.trim() ? parseTime(e) : undefined;
    }

    let playlist = false;
    if (isPlaylistUrl(url)) {
      playlist = await confirm({ message: 'This URL is part of a playlist. Download the whole playlist?', default: false });
    }

    const outputDir = outputOverride ?? defaultOutputDir(format);
    await runOne(url, { format, maxHeight, bitrate, ...clipRange(format, start, end), gif, outputDir, playlist }, bins);
    console.log();
    if (!(await confirm({ message: 'Download another?', default: true }))) return;
  }
}

async function main(): Promise<void> {
  const program = new Command()
    .name('urldl')
    .description('Download YouTube or X (Twitter) URLs as MP4, MP3 or GIF.\nRun with no URL for interactive mode.')
    .argument('[urls...]', 'one or more YouTube / X URLs')
    .addOption(new Option('-f, --format <format>', 'output format').choices(['mp4', 'mp3', 'gif']).default('mp4'))
    .option('-a, --audio', 'shorthand for --format mp3')
    .option('-g, --gif', 'shorthand for --format gif')
    .option('-s, --start <time>', 'clip start, e.g. 1:23 or 83 (any format)')
    .option('-e, --end <time>', `clip end, e.g. 1:30 (GIF default: ${GIF_DEFAULT_SECONDS}s after start)`)
    .option('--gif-width <px>', 'max GIF width', '480')
    .option('--gif-fps <n>', 'GIF frames per second', '15')
    .option('--max-mb <n>', "shrink GIFs to fit this many MB (10 = Discord's free limit, 0 = no limit)", '10')
    .option('-q, --quality <height>', 'max video height for mp4, e.g. 1080, 720, or "best"', 'best')
    .option('-b, --bitrate <kbps>', 'mp3 bitrate, e.g. 320 (default: best VBR)')
    .option('-o, --output <dir>', `output directory (default: ${defaultOutputDir('mp4')} for mp4/gif, ${defaultOutputDir('mp3')} for mp3)`)
    .option('-p, --playlist', 'download the whole playlist when the URL has one')
    .option('--update', 'update the bundled yt-dlp and exit')
    .showHelpAfterError();

  program.parse();
  const opts = program.opts<CliOptions>();
  const urls = program.args;
  const outputOverride = opts.output ? path.resolve(opts.output) : undefined;

  const ytDlp = await getYtDlp({ forceUpdate: opts.update, log });
  if (opts.update) return;
  const bins = { ytDlp, ffmpeg: getFfmpeg() };
  const maxMb = Number(opts.maxMb);
  if (!Number.isFinite(maxMb) || maxMb < 0) throw new Error(`Invalid --max-mb "${opts.maxMb}".`);
  const gif: GifOptions = {
    width: positiveInt(opts.gifWidth, '--gif-width'),
    fps: positiveInt(opts.gifFps, '--gif-fps'),
    maxBytes: Math.floor(maxMb * 1024 * 1024),
  };

  if (urls.length === 0) {
    await interactive(bins, gif, outputOverride);
    return;
  }

  if (opts.audio && opts.gif) throw new Error('Pick one of --audio or --gif.');
  const format: Format = opts.audio ? 'mp3' : opts.gif ? 'gif' : opts.format;
  const clip = clipRange(
    format,
    opts.start !== undefined ? parseTime(opts.start) : undefined,
    opts.end !== undefined ? parseTime(opts.end) : undefined,
  );
  const maxHeight = parseQuality(opts.quality);
  const bitrate = opts.bitrate ? parseInt(opts.bitrate, 10) : undefined;
  if (bitrate !== undefined && !(bitrate > 0)) throw new Error(`Invalid bitrate "${opts.bitrate}".`);
  const outputDir = outputOverride ?? defaultOutputDir(format);

  let failed = 0;
  for (const url of urls) {
    const ok = await runOne(url, { format, maxHeight, bitrate, ...clip, gif, outputDir, playlist: !!opts.playlist }, bins);
    if (!ok) failed++;
  }
  if (urls.length > 1) {
    console.log(pc.dim(`\n${urls.length - failed}/${urls.length} succeeded`));
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  // Ctrl+C inside an inquirer prompt
  if (err instanceof Error && err.name === 'ExitPromptError') {
    console.log(pc.dim('\nBye.'));
    return;
  }
  console.error(`${pc.red('✖')} ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
