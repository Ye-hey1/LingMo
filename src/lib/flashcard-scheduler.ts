import type { FlashcardReviewRating } from '@/types/flashcard'

export interface SchedulerInput {
  ease: number
  interval: number
  repetitions: number
  rating: FlashcardReviewRating
}

export interface SchedulerResult {
  ease: number
  interval: number
  repetitions: number
}

export function scheduleFlashcardReview(input: SchedulerInput): SchedulerResult {
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
