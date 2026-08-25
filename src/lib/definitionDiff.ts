export type DiffEntry =
  | { type: 'unchanged'; text: string }
  | { type: 'removed'; text: string }
  | { type: 'added'; text: string };

/**
 * Splits both texts into "\n\n"-separated senses (the shape dictionary.ts's sense grouping
 * already produces) and diffs the two sequences with an LCS backtrack, so a sense present in
 * both comes out 'unchanged' even when other senses around it were added or removed.
 */
export function diffDefinitions(oldText: string, newText: string): DiffEntry[] {
  const oldSenses = oldText.split('\n\n').filter(Boolean);
  const newSenses = newText.split('\n\n').filter(Boolean);
  return lcsDiff(oldSenses, newSenses);
}

function lcsDiff(a: string[], b: string[]): DiffEntry[] {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const result: DiffEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ type: 'unchanged', text: a[i] });
      i++; j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push({ type: 'removed', text: a[i] });
      i++;
    } else {
      result.push({ type: 'added', text: b[j] });
      j++;
    }
  }
  while (i < n) { result.push({ type: 'removed', text: a[i] }); i++; }
  while (j < m) { result.push({ type: 'added', text: b[j] }); j++; }
  return result;
}
