/**
 * Flashcard import/export utilities
 * Supports CSV and Anki-compatible formats
 */
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
import { open, save } from '@tauri-apps/plugin-dialog'
import type { Flashcard, CreateFlashcardInput } from '@/types/flashcard'

// ─── CSV Export ────────────────────────────────────────────────────

export function flashcardsToCsv(cards: Flashcard[]): string {
  const header = 'front,back,type,tags,status,ease,interval\n'
  const rows = cards.map(card => {
    const front = csvEscape(card.front || '')
    const back = csvEscape(card.back || '')
    const type = card.type
    const tags = csvEscape(card.tags || '')
    const status = card.status
    return `${front},${back},${type},${tags},${status},${card.ease},${card.interval}`
  })
  return header + rows.join('\n')
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

// ─── Anki Export (tab-separated) ───────────────────────────────────

export function flashcardsToAnki(cards: Flashcard[]): string {
  return cards.map(card => {
    const front = (card.front || '').replace(/\t/g, ' ')
    const back = (card.back || '').replace(/\t/g, ' ')
    const tags = (card.tags || '').replace(/\t/g, ' ')
    return [front, back, tags].join('\t')
  }).join('\n')
}

// ─── CSV Import ────────────────────────────────────────────────────

export function parseCsvImport(text: string): CreateFlashcardInput[] {
  const lines = text.split('\n').filter(line => line.trim())
  if (lines.length === 0) return []

  // Skip header if present
  const firstLine = lines[0].toLowerCase()
  const startIndex = firstLine.includes('front') || firstLine.includes('type') ? 1 : 0

  const results: CreateFlashcardInput[] = []
  for (let i = startIndex; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i])
    if (fields.length < 2) continue

    const front = fields[0]?.trim() || ''
    const back = fields[1]?.trim() || ''
    if (!front && !back) continue

    const type = normalizeType(fields[2])
    const tags = fields[3] ? fields[3].split(',').map(t => t.trim()).filter(Boolean) : []

    results.push({
      deckId: 0, // caller must set
      type,
      front: type === 'cloze' ? undefined : front,
      back: type === 'cloze' ? undefined : back,
      clozeText: type === 'cloze' ? front : undefined,
      tags,
    })
  }
  return results
}

// ─── Anki Import (tab-separated) ───────────────────────────────────

export function parseAnkiImport(text: string): CreateFlashcardInput[] {
  const lines = text.split('\n').filter(line => line.trim())
  return lines.map(line => {
    const parts = line.split('\t')
    const front = parts[0]?.trim() || ''
    const back = parts[1]?.trim() || ''
    const tags = parts[2] ? parts[2].split(/\s+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean) : []

    return {
      deckId: 0,
      type: 'basic' as const,
      front,
      back,
      tags,
    }
  }).filter(item => item.front || item.back)
}

// ─── File Dialog Helpers ───────────────────────────────────────────

export async function exportFlashcardFile(
  cards: Flashcard[],
  format: 'csv' | 'anki',
): Promise<{ success: boolean; path?: string }> {
  const content = format === 'csv' ? flashcardsToCsv(cards) : flashcardsToAnki(cards)
  const ext = format === 'csv' ? 'csv' : 'txt'
  const filterName = format === 'csv' ? 'CSV' : 'Text'

  try {
    const filePath = await save({
      defaultPath: `flashcards.${ext}`,
      filters: [{ name: filterName, extensions: [ext] }],
    })
    if (!filePath) return { success: false }

    await writeTextFile(filePath, content)
    return { success: true, path: filePath }
  } catch {
    return { success: false }
  }
}

export async function importFlashcardFile(
  format: 'csv' | 'anki',
): Promise<{ inputs: CreateFlashcardInput[]; success: boolean }> {
  try {
    const ext = format === 'csv' ? 'csv' : 'txt'
    const filterName = format === 'csv' ? 'CSV' : 'Text'

    const filePath = await open({
      multiple: false,
      filters: [{ name: filterName, extensions: [ext] }],
    })
    if (!filePath) return { inputs: [], success: false }

    const content = await readTextFile(filePath as string)
    const inputs = format === 'csv' ? parseCsvImport(content) : parseAnkiImport(content)

    return { inputs, success: true }
  } catch {
    return { inputs: [], success: false }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        fields.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }
  fields.push(current)
  return fields
}

function normalizeType(raw?: string): CreateFlashcardInput['type'] {
  const t = (raw || 'basic').trim().toLowerCase()
  if (t === 'choice') return 'choice'
  if (t === 'basic-reversed') return 'basic-reversed'
  if (t === 'cloze') return 'cloze'
  if (t === 'true-false') return 'true-false'
  if (t === 'short-answer') return 'short-answer'
  return 'basic'
}
