import { ELO_INITIAL, ELO_K, ELO_SCALE } from "../config/relays.js";
import type { EloCalculation, EloRow, ParsedEntry } from "./types.js";
import { round6 } from "./utils.js";

export function calculateElo(
  presentationOrder: string[],
  entries: ParsedEntry[],
): EloCalculation {
  const order = [...new Set(presentationOrder)];
  const ratings = new Map<string, number>();
  const pairwiseVotes = new Map<string, number>();
  const pairs: EloCalculation["pairs"] = [];

  for (const demo of order) {
    ratings.set(demo, ELO_INITIAL);
    pairwiseVotes.set(demo, 0);
  }

  for (let later = 1; later < order.length; later += 1) {
    for (let earlier = 0; earlier < later; earlier += 1) {
      const demoA = order[earlier];
      const demoB = order[later];
      if (!demoA || !demoB) continue;

      let votesA = 0;
      let votesB = 0;
      for (const entry of entries) {
        if (entry.author === demoA || entry.author === demoB) continue;
        const positionA = entry.content.ranking.indexOf(demoA);
        const positionB = entry.content.ranking.indexOf(demoB);
        if (positionA < 0 || positionB < 0 || positionA === positionB) continue;
        if (positionA < positionB) votesA += 1;
        else votesB += 1;
      }

      const total = votesA + votesB;
      if (total === 0) continue;
      const ratingA = ratings.get(demoA) ?? ELO_INITIAL;
      const ratingB = ratings.get(demoB) ?? ELO_INITIAL;
      const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / ELO_SCALE));
      const actualA = votesA / total;
      const delta = ELO_K * (actualA - expectedA);

      ratings.set(demoA, round6(ratingA + delta));
      ratings.set(demoB, round6(ratingB - delta));
      pairwiseVotes.set(demoA, (pairwiseVotes.get(demoA) ?? 0) + total);
      pairwiseVotes.set(demoB, (pairwiseVotes.get(demoB) ?? 0) + total);
      pairs.push({
        demo_a: demoA,
        demo_b: demoB,
        votes_a_over_b: votesA,
        votes_b_over_a: votesB,
        actual_score_a: round6(actualA),
      });
    }
  }

  const rows: EloRow[] = order
    .map((pubkey) => ({
      pubkey,
      rating: round6(ratings.get(pubkey) ?? ELO_INITIAL),
      pairwiseVotes: pairwiseVotes.get(pubkey) ?? 0,
    }))
    .sort((a, b) => b.rating - a.rating || a.pubkey.localeCompare(b.pubkey));

  return { rows, pairs };
}

export function rankElo(rows: EloRow[]): Array<{ rank: number; pubkey: string; rating: number }> {
  return rows.map((row, index) => ({
    rank: index + 1,
    pubkey: row.pubkey,
    rating: round6(row.rating),
  }));
}
