import type { FlashcardReviewRating, FlashcardStatus } from '@/types/flashcard'

export interface SchedulerInput {
  ease: number
  interval: number
  repetitions: number
  status: FlashcardStatus
}

export interface SchedulerResult {
  ease: number
  interval: number
  repetitions: number
  status: FlashcardStatus
  dueAt: number
}

/**
 * Fuzz factor to spread cards due on the same day.
 * Anki-style: adds a small random offset so cards don't all pile up.
 */
function fuzzInterval(interval: number): number {
  if (interval <= 1) return interval

  // For short intervals, no fuzz
  if (interval <= 4) return interval

  // For medium intervals (5-30 days), add ±1 day
  if (interval <= 30) return Math.max(1, interval + Math.round((Math.random() - 0.5) * 2))

  // For longer intervals, add proportional fuzz (up to ±5%)
  const fuzz = Math.max(1, Math.round(interval * 0.05))
  return Math.max(1, interval + Math.round((Math.random() - 0.5) * 2 * fuzz))
}

/**
 * Calculate the next due timestamp based on interval in days.
 */
function calculateDueAt(intervalDays: number): number {
  return Date.now() + intervalDays * 24 * 60 * 60 * 1000
}

/**
 * Learning steps for new cards (Anki-style).
 * A new card goes through these intervals before graduating to review.
 */
const LEARNING_STEPS = [1, 10] // minutes

/**
 * When a card fails during learning, it goes back to step 0.
 */
function learningStepDueAt(stepIndex: number): number {
  const minutes = LEARNING_STEPS[Math.min(stepIndex, LEARNING_STEPS.length - 1)]
  return Date.now() + minutes * 60 * 1000
}

/**
 * Enhanced SM-2 scheduler with:
 * - Learning steps for new cards
 * - Fuzz factor for review cards
 * - Proper ease factor adjustments
 */
export function scheduleFlashcardReview(input: SchedulerInput): SchedulerResult {
  const { ease, interval, repetitions, status } = input

  // New cards: put through learning steps
  if (status === 'new') {
    return {
      ease: Math.max(1.3, 2.5),
      interval: 0,
      repetitions: 0,
      status: 'learning',
      dueAt: learningStepDueAt(0),
    }
  }

  // Learning cards: advance through steps or graduate
  if (status === 'learning') {
    return {
      ease: Math.max(1.3, ease || 2.5),
      interval: 0,
      repetitions,
      status: repetitions >= LEARNING_STEPS.length ? 'review' : 'learning',
      dueAt: repetitions >= LEARNING_STEPS.length
        ? calculateDueAt(1) // Graduate: due tomorrow
        : learningStepDueAt(repetitions),
    }
  }

  // Review cards: standard SM-2 with fuzz
  // Rating is passed externally; this function is called after rating is known.
  // For backward compat, we use the rating from outside.
  return {
    ease: Math.max(1.3, ease),
    interval: Math.max(1, interval),
    repetitions,
    status: 'review',
    dueAt: calculateDueAt(Math.max(1, fuzzInterval(interval))),
  }
}

/**
 * Apply a rating to a review card and get the next scheduling.
 */
export function applyReviewRating(
  ease: number,
  interval: number,
  repetitions: number,
  rating: FlashcardReviewRating,
): Pick<SchedulerResult, 'ease' | 'interval' | 'repetitions' | 'dueAt'> {
  if (rating === 0) {
    // Forgot: reset to learning
    const newEase = Math.max(1.3, ease - 0.2)
    return {
      ease: newEase,
      interval: 0,
      repetitions: 0,
      dueAt: learningStepDueAt(0),
    }
  }

  if (rating === 1) {
    // Hard: shorter interval, slight ease decrease
    const newEase = Math.max(1.3, ease - 0.15)
    if (interval <= 0) {
      return {
        ease: newEase,
        interval: 0,
        repetitions,
        dueAt: learningStepDueAt(1),
      }
    }
    const newInterval = Math.max(1, Math.round(interval * 1.2))
    return {
      ease: newEase,
      interval: newInterval,
      repetitions,
      dueAt: calculateDueAt(fuzzInterval(newInterval)),
    }
  }

  if (rating === 2) {
    // Good: standard interval
    const newEase = Math.max(1.3, ease)
    const newInterval = interval <= 0 ? 1 : Math.max(1, Math.round(interval * ease))
    return {
      ease: newEase,
      interval: newInterval,
      repetitions: repetitions + 1,
      dueAt: calculateDueAt(fuzzInterval(newInterval)),
    }
  }

  // Easy: boosted interval
  const newEase = Math.max(1.3, ease + 0.05)
  const newInterval = interval <= 0 ? 2 : Math.max(2, Math.round(interval * (ease + 0.15)))
  return {
    ease: newEase,
    interval: newInterval,
    repetitions: repetitions + 1,
    dueAt: calculateDueAt(fuzzInterval(newInterval)),
  }
}

/**
 * @deprecated Use applyReviewRating instead for enhanced scheduling.
 * Kept for backward compatibility.
 */
export function scheduleFlashcardReviewLegacy(input: { ease: number; interval: number; repetitions: number; rating: FlashcardReviewRating }): {
  ease: number
  interval: number
  repetitions: number
} {
  const { ease, interval, repetitions, rating } = input

  if (rating === 0) {
    return {
      ease: Math.max(1.3, ease - 0.2),
      interval: 1,
      repetitions: 0,
    }
  }

  if (rating === 1) {
    return {
      ease: Math.max(1.3, ease - 0.15),
      interval: Math.max(1, Math.round((interval || 1) * 1.2)),
      repetitions,
    }
  }

  if (rating === 2) {
    return {
      ease: Math.max(1.3, ease),
      interval: interval <= 0 ? 1 : Math.max(1, Math.round(interval * ease)),
      repetitions: repetitions + 1,
    }
  }

  return {
    ease: Math.max(1.3, ease + 0.05),
    interval: interval <= 0 ? 2 : Math.max(2, Math.round(interval * (ease + 0.15))),
    repetitions: repetitions + 1,
  }
}
