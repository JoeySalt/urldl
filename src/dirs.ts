import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Format } from './download.js';

type UserDir = 'VIDEOS' | 'DOWNLOAD';

const FALLBACK: Record<UserDir, string> = {
  VIDEOS: process.platform === 'darwin' ? 'Movies' : 'Videos',
  DOWNLOAD: 'Downloads',
};

/** Look up an XDG user dir (e.g. XDG_VIDEOS_DIR) from user-dirs.dirs, with a sensible fallback. */
function userDir(name: UserDir): string {
  const home = os.homedir();
  if (process.platform === 'linux') {
    const configHome = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
    try {
      const file = readFileSync(path.join(configHome, 'user-dirs.dirs'), 'utf8');
      const m = file.match(new RegExp(`^XDG_${name}_DIR="(.*)"`, 'm'));
      if (m) {
        const dir = m[1].replace(/^\$HOME/, home);
        // A value equal to $HOME means "disabled" per the XDG spec.
        if (dir && dir !== home && dir !== `${home}/`) return dir;
      }
    } catch {
      // no user-dirs.dirs; use fallback
    }
  }
  return path.join(home, FALLBACK[name]);
}

/** Default output folder: videos and GIFs go to the Videos folder, audio to Downloads. */
export function defaultOutputDir(format: Format): string {
  return userDir(format === 'mp3' ? 'DOWNLOAD' : 'VIDEOS');
}
