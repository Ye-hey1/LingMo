export const FLASHCARD_TAB_ID = 'workspace-flashcards'
export const FLASHCARD_TAB_PATH = 'note-gen://flashcards'
export const FLASHCARD_TAB_NAME = '闪卡'

export function isFlashcardTabPath(path: string) {
  return path === FLASHCARD_TAB_PATH
}
