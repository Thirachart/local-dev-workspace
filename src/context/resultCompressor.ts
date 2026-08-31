export interface DiffResult { patch: string; truncated: boolean }

export function createBoundedLineDiff(before: string, after: string, maxChars = 12000): DiffResult {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
  const oldChunk = a.slice(start, endA + 1).map((line) => `-${line}`);
  const newChunk = b.slice(start, endB + 1).map((line) => `+${line}`);
  let patch = [`@@ -${start + 1},${Math.max(0, endA - start + 1)} +${start + 1},${Math.max(0, endB - start + 1)} @@`, ...oldChunk, ...newChunk].join('\n');
  const truncated = patch.length > maxChars;
  if (truncated) patch = patch.slice(0, maxChars);
  return { patch, truncated };
}
