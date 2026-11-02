import type { ContestType } from '@prisma/client';
import { securePick, secureWeightedPick } from '../../lib/rng.js';

export interface Candidate {
  tgUserId: bigint;
  username?: string | null;
  firstName?: string | null;
  participantId?: string;
  position?: number | null;
  score: number;
}

export interface SelectConfig {
  activityMode?: 'most_active' | 'random' | 'weighted' | 'threshold';
  minMessages?: number;
  prizePositions?: number[]; // SMS prize queue
  excludeTgIds?: bigint[];
}

/**
 * Pure selection logic for every contest type. Randomness comes from crypto.randomInt.
 * Returns candidates in place order (index 0 = 1st place).
 */
export function selectWinners(type: ContestType, candidates: Candidate[], count: number, cfg: SelectConfig = {}): Candidate[] {
  const excluded = new Set((cfg.excludeTgIds ?? []).map(String));
  // uniqueness by Telegram user id
  const seen = new Set<string>();
  const pool = candidates.filter((c) => {
    const k = String(c.tgUserId);
    if (excluded.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!pool.length || count <= 0) return [];

  switch (type) {
    case 'FIRST_COMMENT':
      return [...pool].sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity)).slice(0, count);

    case 'STARS_AUCTION':
      return [...pool].sort((a, b) => b.score - a.score).slice(0, 1);

    case 'SMS_COUNTER': {
      if (cfg.prizePositions?.length) {
        const byPos = new Map(pool.map((c) => [c.position, c]));
        return cfg.prizePositions.map((p) => byPos.get(p)).filter((c): c is Candidate => !!c);
      }
      return securePick(pool, count);
    }

    case 'ACTIVITY':
    case 'MESSAGE_GIVEAWAY': {
      const min = cfg.minMessages ?? 1;
      const eligible = pool.filter((c) => c.score >= min);
      switch (cfg.activityMode ?? (type === 'ACTIVITY' ? 'most_active' : 'random')) {
        case 'most_active': {
          // ties broken randomly
          const shuffled = securePick(eligible, eligible.length);
          return shuffled.sort((a, b) => b.score - a.score).slice(0, count);
        }
        case 'weighted':
          return secureWeightedPick(eligible.map((c) => ({ item: c, weight: c.score })), count);
        case 'threshold':
        case 'random':
        default:
          return securePick(eligible, count);
      }
    }

    default:
      return securePick(pool, count);
  }
}
