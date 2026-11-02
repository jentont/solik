import { randomBytes, randomInt } from 'node:crypto';

/** Cryptographically secure Fisher–Yates pick of `count` distinct items. */
export function securePick<T>(items: readonly T[], count: number): T[] {
  const arr = items.slice();
  const n = Math.min(count, arr.length);
  for (let i = 0; i < n; i++) {
    const j = i + randomInt(arr.length - i);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, n);
}

/** Weighted pick without replacement (weights > 0). */
export function secureWeightedPick<T>(items: readonly { item: T; weight: number }[], count: number): T[] {
  const pool = items.filter((i) => i.weight > 0).slice();
  const out: T[] = [];
  while (out.length < count && pool.length) {
    const total = pool.reduce((s, i) => s + i.weight, 0);
    // randomInt upper bound is limited to 2^48; weights are message counts so this is fine.
    let r = randomInt(Math.max(1, Math.floor(total)));
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= pool[idx]!.weight;
      if (r < 0) break;
    }
    idx = Math.min(idx, pool.length - 1);
    out.push(pool[idx]!.item);
    pool.splice(idx, 1);
  }
  return out;
}

export function drawSeed(): string {
  return randomBytes(16).toString('hex');
}
