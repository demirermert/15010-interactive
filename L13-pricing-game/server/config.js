// Checks a game's settings before a session is created (2026-11-02 audit). Every number the instructor's form can send
// is bounded here, so a typo cannot end a round instantly, stall it for a day, or make demand come out NaN.
// Throws an Error whose message the form shows to the instructor.

const num = (v, name, lo, hi, { integer = false, fallback } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`${name} is missing.`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number.`);
  if (integer && !Number.isInteger(n)) throw new Error(`${name} must be a whole number.`);
  if (n < lo || n > hi) throw new Error(`${name} must be between ${lo} and ${hi}.`);
  return n;
};

export function validateConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  out.rounds = num(c.rounds, 'Rounds', 1, 200, { integer: true, fallback: 10 });
  if (Array.isArray(c.roundTime)) {
    if (c.roundTime.length === 0) throw new Error('Give each round a time, or untick "different time for each round".');
    const times = c.roundTime.map((t, i) => num(t, `Round ${i + 1} time (seconds)`, 3, 3600));
    while (times.length < out.rounds) times.push(times[times.length - 1]);
    out.roundTime = times.slice(0, out.rounds);
  } else {
    out.roundTime = num(c.roundTime, 'Seconds per round', 3, 3600, { fallback: 30 });
  }
  out.breakTime = num(c.breakTime ?? c.resultRevealTime, 'Break between rounds (seconds)', 3, 600, { fallback: 10 });
  out.resultRevealTime = out.breakTime;
  const pb = c.priceBounds && typeof c.priceBounds === 'object' ? c.priceBounds : {};
  const min = num(pb.min, 'Min price', 0, 1e6, { fallback: 0 });
  const max = num(pb.max, 'Max price', 0, 1e6, { fallback: 100 });
  if (max <= min) throw new Error('Max price must be higher than min price.');
  out.priceBounds = { min, max };
  out.modelType = c.modelType === 'logit' ? 'logit' : 'hotelling';
  if (out.modelType === 'logit') {
    out.marketSize = num(c.marketSize, 'Market size', 1, 1e9, { fallback: 1000 });
    out.alpha = num(c.alpha, 'Price sensitivity (alpha)', 0, 1e6, { fallback: 1 });
    out.sigma = num(c.sigma, 'Differentiation (sigma)', 0.01, 1e6, { fallback: 5 });
  } else {
    out.marketSize = 100;
    out.travelCost = num(c.travelCost, 'Travel cost (t)', 0, 1e6, { fallback: 1 });
    out.consumerValue = num(c.consumerValue, 'Consumer valuation (V)', 0.01, 1e9, { fallback: 100 });
    out.x1 = num(c.x1, 'Firm 1 location', 0, 100, { fallback: 0 });
    out.x2 = num(c.x2, 'Firm 2 location', 0, 100, { fallback: 100 });
    if (out.consumerValue <= out.priceBounds.min) throw new Error('Consumer valuation must be above the min price, or nobody can ever buy.');
  }
  out.enableChat = Boolean(c.enableChat);
  out.hideRoundCount = Boolean(c.hideRoundCount);
  out.showOpponentName = Boolean(c.showOpponentName);
  out.showModelParameters = Boolean(c.showModelParameters);
  return out;
}

// What a student is told about the game: the same config without the round count when it is hidden
// (a per-round time list would give the count away too, so it becomes its first value).
export function studentConfig(config) {
  if (!config?.hideRoundCount) return config;
  const { rounds, roundTime, ...rest } = config;
  return { ...rest, roundTime: Array.isArray(roundTime) ? roundTime[0] : roundTime };
}

// A player's display name: trimmed, one space between words, at most 40 characters.
export function cleanName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/\s+/g, ' ').trim().slice(0, 40);
}
