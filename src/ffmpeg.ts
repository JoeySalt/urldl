import { spawn } from 'node:child_process';
import { rename, rm } from 'node:fs/promises';

/** Run ffmpeg on local files; rejects with its error output on failure. */
export function runFfmpeg(ffmpeg: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${signal ?? code}): ${err.trim().split('\n').pop() ?? ''}`)),
    );
  });
}

/** Input-side seek args: fast, and frame-accurate when the output is re-encoded. */
export function seekArgs(start?: number, end?: number): string[] {
  const args: string[] = [];
  if (start !== undefined) args.push('-ss', String(start));
  if (end !== undefined) args.push('-to', String(end));
  return args;
}

/**
 * Trim a downloaded file in place.
 *
 * We trim locally instead of using yt-dlp's --download-sections because that
 * makes ffmpeg fetch the stream itself, and the static ffmpeg build segfaults on
 * network input on systems whose DNS goes through NSS plugins (mdns, resolved).
 */
export async function trimFile(ffmpeg: string, file: string, start?: number, end?: number): Promise<void> {
  const tmp = file.replace(/(\.[^.]+)$/, '.trim$1');
  const codec = file.endsWith('.mp3')
    ? // MP3 frames are ~26 ms, so stream copy is accurate enough; keep cover art.
      ['-map', '0', '-c', 'copy', '-id3v2_version', '3']
    : // Re-encode so the clip starts exactly where asked, not at a keyframe.
      ['-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'];
  try {
    await runFfmpeg(ffmpeg, [...seekArgs(start, end), '-i', file, ...codec, tmp]);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
