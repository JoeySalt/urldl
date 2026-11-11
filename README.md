# urldl

Console app that downloads YouTube and X (Twitter) URLs as **MP4** (video), **MP3** (audio) or **GIF**.

It wraps [yt-dlp](https://github.com/yt-dlp/yt-dlp), which it downloads on first run to your
user cache dir and updates automatically once a week. ffmpeg comes from `ffmpeg-static`, so
nothing needs to be installed system-wide.

## Setup (once)

```bash
pnpm run setup
```

This installs dependencies, builds, and puts a `urldl` command on your PATH
(a symlink in `$(pnpm bin -g)`). Re-run it after changing the code.

## Usage

```bash
urldl "https://www.youtube.com/watch?v=jNQXAC9IVRw"   # MP4 → ~/Videos
urldl -a "https://x.com/user/status/123"             # MP3 → ~/Downloads
urldl -g -s 1:05 -e 1:12 "https://youtu.be/..."      # GIF of 1:05–1:12 → ~/Videos
urldl -s 2:00 -e 2:30 "https://youtu.be/..."         # 30s MP4 clip
urldl                                                # interactive mode
urldl -q 720 -o ~/Videos URL1 URL2                    # 720p, custom folder, several URLs
urldl -a -b 320 -p "https://www.youtube.com/playlist?list=..."  # whole playlist as MP3
```

To uninstall the command: `rm "$(pnpm bin -g)/urldl"`.

| Option | Description |
| --- | --- |
| `-f, --format <mp4\|mp3\|gif>` | Output format (default `mp4`) |
| `-a, --audio` | Shorthand for `--format mp3` |
| `-g, --gif` | Shorthand for `--format gif` |
| `-s, --start <time>` | Clip start: `83`, `1:23` or `1:02:03` (any format) |
| `-e, --end <time>` | Clip end (GIFs default to 15 s after the start) |
| `--gif-width <px>` | Max GIF width (default `480`) |
| `--gif-fps <n>` | GIF frame rate (default `15`) |
| `--max-mb <n>` | Shrink GIFs until they fit (default `10`, Discord's free limit; `0` = off) |
| `-q, --quality <height>` | Max video height, e.g. `1080`, `720`, or `best` (default) |
| `-b, --bitrate <kbps>` | MP3 bitrate, e.g. `320` (default: best VBR) |
| `-o, --output <dir>` | Output directory (default: your Videos folder for MP4/GIF, Downloads for MP3, read from `~/.config/user-dirs.dirs`) |
| `-p, --playlist` | Download the full playlist if the URL has `list=` |
| `--update` | Force a yt-dlp update and exit |

MP4s use H.264 + AAC where available so they play everywhere. MP3s get embedded metadata and
cover art. GIFs use a per-clip colour palette, and if one comes out over `--max-mb` it is
re-rendered smaller (lower width, then lower frame rate) until it fits.

Clips are trimmed locally after downloading, so a clip from a long video still downloads the
whole video. (yt-dlp's partial download hands the URL to ffmpeg, and the bundled static ffmpeg
crashes on network input on systems whose DNS goes through NSS plugins.)

### Environment overrides

- `YTDLP_PATH` — use a specific yt-dlp binary instead of the managed one
- `FFMPEG_PATH` — use a specific ffmpeg binary

## Notes

- If YouTube downloads suddenly start failing, run `urldl --update`. YouTube changes often
  and yt-dlp ships fixes quickly.
- Some X posts (age-restricted, private, or login-walled) can't be downloaded without being
  logged in.
- Only download content you have the rights to.
