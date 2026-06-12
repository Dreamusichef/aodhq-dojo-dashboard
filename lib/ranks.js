'use strict';

const RANKS = [
  { name: 'Elite Jōnin', min: 50 },
  { name: 'Chūnin', min: 20 },
  { name: 'Genin', min: 1 },
  { name: 'Ghost', min: 0 },
];

function getRank(clipCount) {
  for (const r of RANKS) {
    if (clipCount >= r.min) return r;
  }
  return RANKS[RANKS.length - 1];
}

module.exports = { RANKS, getRank };
