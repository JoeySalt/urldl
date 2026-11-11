import { open, rm, stat } from 'node:fs/promises';
import pc from 'picocolors';
import { runFfmpeg, seekArgs } from './ffmpeg.js';

export interface Clip {
  start?: number;
  end?: number;
}

export interface GifOptions {
  /** Max width in px (never upscales). */
  width: number;
  fps: number;
  /** Shrink until the GIF fits in this many bytes. 0 = no limit. */
  maxBytes: number;
}

function ffmpegToGif(ffmpeg: string, input: string, output: string, width: number, fps: number, clip: Clip): Promise<void> {
  // Build a palette from the clip, then dither with it: far better colours
  // than ffmpeg's default 256-colour GIF palette.
  const filter =
    `fps=${fps},scale='min(${width},iw)':-1:flags=lanczos,split[a][b];` +
    `[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
  return runFfmpeg(ffmpeg, [...seekArgs(clip.start, clip.end), '-i', input, '-vf', filter, '-loop', '0', output]);
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Read the canvas width from a GIF header (bytes 6-7, little-endian). */
async function gifWidth(file: string): Promise<number> {
  const fh = await open(file, 'r');
  try {
    const { buffer } = await fh.read(Buffer.alloc(10), 0, 10, 0);
    return buffer.readUInt16LE(6);
  } finally {
    await fh.close();
  }
}

/** Width/fps scale factors tried, in order, when a GIF is over the size limit. */
const SHRINK_STEPS: Array<[number, number]> = [[0.8, 1], [0.65, 0.8], [0.5, 0.67], [0.4, 0.55], [0.3, 0.5]];

/**
 * Convert a video to GIF. If maxBytes is set, retry with smaller width/fps
 * until it fits (GIFs get huge fast, and Discord caps free uploads at 10 MB).
 */
export async function videoToGif(ffmpeg: string, input: string, output: string, o: GifOptions, clip: Clip = {}): Promise<void> {
  const tty = process.stdout.isTTY;
  const render = async (width: number, fps: number) => {
    if (tty) process.stdout.write(`\r\x1b[2K  ${pc.dim(`Making GIF (${width}px, ${fps} fps)...`)}`);
    await ffmpegToGif(ffmpeg, input, output, width, fps, clip);
    if (tty) process.stdout.write('\r\x1b[2K');
    return (await stat(output)).size;
  };

  let size = await render(o.width, o.fps);
  if (o.maxBytes === 0 || size <= o.maxBytes) return;

  // Shrink relative to the real width: a 320px source asked for 480px is 320px,
  // so scaling from 480 would waste attempts that produce the same GIF.
  const baseWidth = await gifWidth(output);
  for (const [i, [wf, ff]] of SHRINK_STEPS.entries()) {
    const width = Math.max(120, Math.round(baseWidth * wf));
    const fps = Math.max(6, Math.round(o.fps * ff));
    await rm(output, { force: true });
    size = await render(width, fps);
    if (size <= o.maxBytes) {
      console.log(pc.dim(`  Shrunk to ${width}px / ${fps} fps to fit under ${mb(o.maxBytes)} (${mb(size)})`));
      return;
    }
    if (i === SHRINK_STEPS.length - 1) {
      console.log(
        pc.yellow(`  GIF is ${mb(size)}, still over ${mb(o.maxBytes)}. Use a shorter clip (--start/--end) or raise --max-mb.`),
      );
    }
  }
}
