export type SmootherState = {
  carryChars: number;
  displayedLength: number;
};

export type SmootherStepResult = SmootherState & {
  charsAdded: number;
};

// P0-5：弱化打字机、追求跟手。
// 旧策略在 backlog <= 24 时强制 40 字/秒，而模型本身常有 30-60 字/秒，
// 叠加下游 markdown 渲染节流后会让"模型已经输出、界面还在慢慢吐字"。
// 新策略把低 backlog 档位提到接近实时（跟手），仅在明显积压时才平滑追赶。
const MIN_CHARS_PER_SECOND = 260;
const SLOW_CHARS_PER_SECOND = 420;
const MID_CHARS_PER_SECOND = 640;
const HIGH_CHARS_PER_SECOND = 900;
const MAX_CHARS_PER_SECOND = 1600;

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
