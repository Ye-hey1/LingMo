export type FlashcardType =
  | 'basic'
  | 'basic-reversed'
  | 'cloze'
  | 'choice'
  | 'short-answer'

export type FlashcardReviewRating = 0 | 1 | 2 | 3

export type FlashcardStatus = 'new' | 'learning' | 'review' | 'suspended'

export interface FlashcardDeck {
  id: number
  name: string
  description?: string | null
  createdAt: number
  updatedAt: number
}

export interface FlashcardDeckSummary extends FlashcardDeck {
  cardCount: number
  dueCount: number
  masteredCount: number
  lastReviewAt?: number | null
}

export interface Flashcard {
  id: number
  deckId: number
  noteId?: number | null
  notePath?: string | null
  type: FlashcardType
  front?: string | null
  back?: string | null
  clozeText?: string | null
  tags?: string | null
  status: FlashcardStatus
  ease: number
  interval: number
  repetitions: number
  dueAt: number
  lastReviewAt?: number | null
  createdAt: number
  updatedAt: number
}

export interface FlashcardReview {
  id: number
  flashcardId: number
  rating: FlashcardReviewRating
  reviewedAt: number
  prevEase: number
  nextEase: number
  prevInterval: number
  nextInterval: number
}

export interface FlashcardLearningStats {
  todayReviewedCount: number
  todayMasteredCount: number
  todayMasteryRate: number
  weakCount: number
}

export interface CreateFlashcardInput {
  deckId: number
  type: FlashcardType
  front?: string
  back?: string
  clozeText?: string
  tags?: string[]
  noteId?: number
  notePath?: string
}

export interface GenerateFlashcardDraft {
  type: FlashcardType
  front?: string
  back?: string
  clozeText?: string
}
