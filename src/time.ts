/** Parse "90", "1:30", "1:02:03" or "12.5" into seconds. */
export function parseTime(input: string): number {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$|^\d+:[0-5]?\d(\.\d+)?$|^\d+:[0-5]?\d:[0-5]?\d(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid time "${input}". Use seconds (90), MM:SS (1:30) or HH:MM:SS (1:02:03).`);
  }
  return s.split(':').reduce((acc, part) => acc * 60 + parseFloat(part), 0);
}

/** Format seconds as M:SS or H:MM:SS for display. */
export function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = +(sec % 60).toFixed(2);
  const ss = String(s).padStart(s < 10 ? (Number.isInteger(s) ? 2 : 4) : 0, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
