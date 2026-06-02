export type ArtifactInputFormat =
  | 'markdown'
  | 'html'
  | 'json'
  | 'csv'
  | 'tsv'
  | 'sql'
  | 'yaml'
  | 'text'

export type ArtifactTemplateId =
  | 'article-report'
  | 'data-report'
  | 'deck-brief'
  | 'poster-card'

export type ArtifactScenario =
  | 'note'
  | 'data'
  | 'deck'
  | 'poster'

export interface ArtifactTemplate {
  id: ArtifactTemplateId
  name: string
  scenario: ArtifactScenario
  description: string
  aspectHint: string
  outputHint: string
}

export interface ArtifactInputSummary {
  format: ArtifactInputFormat
  raw: string
  preview: string
  structured?: unknown
}

