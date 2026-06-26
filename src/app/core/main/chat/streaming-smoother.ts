export type SmootherState = {
  carryChars: number;
  displayedLength: number;
};

export type SmootherStepResult = SmootherState & {
  charsAdded: number;
};

const MIN_CHARS_PER_SECOND = 40;
const SLOW_CHARS_PER_SECOND = 96;
const MID_CHARS_PER_SECOND = 220;
const HIGH_CHARS_PER_SECOND = 520;
const MAX_CHARS_PER_SECOND = 1100;

export function getAdaptiveCharsPerSecond(backlog: number): number {
  if (backlog > 1000) return MAX_CHARS_PER_SECOND;
  if (backlog > 480) return HIGH_CHARS_PER_SECOND;
  if (backlog > 120) return MID_CHARS_PER_SECOND;
  if (backlog > 24) return SLOW_CHARS_PER_SECOND;
  return MIN_CHARS_PER_SECOND;
}

export function advanceStreamingSmoother(
  state: SmootherState,
  targetLength: number,
  elapsedMs: number,
): SmootherStepResult {
  const safeElapsedMs = Math.max(0, elapsedMs);
  const backlog = Math.max(0, targetLength - state.displayedLength);

  if (backlog === 0) {
    return {
      carryChars: 0,
      displayedLength: state.displayedLength,
      charsAdded: 0,
    };
  }

  const charsPerSecond = getAdaptiveCharsPerSecond(backlog);
  const producedChars = state.carryChars + (charsPerSecond * safeElapsedMs) / 1000;
  let charsToAdd = Math.floor(producedChars);

  // Make the first visible update happen quickly after new content arrives.
  if (charsToAdd === 0 && safeElapsedMs >= 32) {
    charsToAdd = 1;
  }

  charsToAdd = Math.min(charsToAdd, backlog);

  return {
    carryChars: producedChars - charsToAdd,
    displayedLength: state.displayedLength + charsToAdd,
    charsAdded: charsToAdd,
  };
}
