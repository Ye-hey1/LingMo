const DEFAULT_PAGE_ID = 'lingmo-ai-page'
const DEFAULT_PAGE_NAME = 'Page 1'

const DEFAULT_MX_GRAPH_MODEL_ATTRS = [
  'dx="1200"',
  'dy="800"',
  'grid="1"',
  'gridSize="10"',
  'guides="1"',
  'tooltips="1"',
  'connect="1"',
  'arrows="1"',
  'fold="1"',
  'page="0"',
  'pageScale="1"',
  'pageWidth="1200"',
  'pageHeight="800"',
  'math="0"',
  'shadow="0"',
].join(' ')

export interface NormalizeDrawioXmlOptions {
  pageName?: string
  pageId?: string
  rejectIncompleteCells?: boolean
}

export interface NormalizeDrawioXmlResult {
  xml: string
  warnings: string[]
  fixes: string[]
  incomplete: boolean
}

export interface DrawioCellOperation {
  operation: 'add' | 'update' | 'delete'
  cell_id: string
  new_xml?: string
}

export interface DrawioOperationError {
  type: DrawioCellOperation['operation']
  cellId: string
  message: string
}

export interface ApplyDrawioOperationsResult {
  xml: string
  errors: DrawioOperationError[]
  warnings: string[]
}

export interface DrawioInspectionIssue {
  code: string
  message: string
  cellId?: string
  relatedCellId?: string
}

export interface DrawioInspectionStats {
  pages: number
  cells: number
  vertices: number
  edges: number
  groups: number
  duplicateIds: number
  missingGeometry: number
  invalidEdges: number
  overlaps: number
}

export interface DrawioInspectionResult {
  valid: boolean
  issues: DrawioInspectionIssue[]
  warnings: DrawioInspectionIssue[]
  stats: DrawioInspectionStats
  normalizedXml?: string
  fixes: string[]
}

interface VertexBounds {
  id: string
  x: number
  y: number
  width: number
  height: number
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function ensureDomParser(): void {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    throw new Error('Draw.io XML operations require DOMParser/XMLSerializer in the browser runtime.')
  }
}

function parseXml(xml: string): Document {
  ensureDomParser()
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'text/xml')
  const parseError = getXmlParseError(doc)
  if (parseError) {
    throw new Error(parseError)
  }
  return doc
}

function getXmlParseError(doc: Document): string | null {
  const parserError = doc.querySelector('parsererror')
  if (!parserError && doc.documentElement?.nodeName !== 'parsererror') {
    return null
  }

  const text = parserError?.textContent || doc.documentElement?.textContent || ''
  return `XML parse error: ${text.trim() || 'invalid XML'}`
}

function serializeXml(doc: Document): string {
  ensureDomParser()
  return new XMLSerializer().serializeToString(doc)
}

function removeXmlComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '')
}

function fixCommonXmlText(xml: string): { fixed: string; fixes: string[] } {
  let fixed = removeXmlComments(xml.trim())
  const fixes: string[] = []

  const replacements: Array<[RegExp, string, string]> = [
    [/<Cell\b/gi, '<mxCell', 'Fixed <Cell> tags to <mxCell>.'],
    [/<\/Cell>/gi, '</mxCell>', 'Fixed </Cell> tags to </mxCell>.'],
    [/<mxcell\b/g, '<mxCell', 'Fixed <mxcell> tags to <mxCell>.'],
    [/<\/mxcell>/g, '</mxCell>', 'Fixed </mxcell> tags to </mxCell>.'],
    [/<mxgeometry\b/g, '<mxGeometry', 'Fixed <mxgeometry> tags to <mxGeometry>.'],
    [/<\/mxgeometry>/g, '</mxGeometry>', 'Fixed </mxgeometry> tags to </mxGeometry>.'],
    [/<mxpoint\b/g, '<mxPoint', 'Fixed <mxpoint> tags to <mxPoint>.'],
    [/<\/mxpoint>/g, '</mxPoint>', 'Fixed </mxpoint> tags to </mxPoint>.'],
  ]

  for (const [pattern, replacement, label] of replacements) {
    const before = fixed
    fixed = fixed.replace(pattern, replacement)
    if (fixed !== before) fixes.push(label)
  }

  const ampFixed = fixed.replace(/&(?!(?:lt|gt|amp|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/g, '&amp;')
  if (ampFixed !== fixed) {
    fixed = ampFixed
    fixes.push('Escaped standalone ampersands.')
  }

  return { fixed, fixes }
}

function stripProviderWrapperSuffix(xml: string): string {
  const completeWrappers: Array<{ open: RegExp; close: string }> = [
    { open: /<mxfile\b/i, close: '</mxfile>' },
    { open: /<mxGraphModel\b/i, close: '</mxGraphModel>' },
    { open: /<root\b/i, close: '</root>' },
  ]

  for (const wrapper of completeWrappers) {
    if (!wrapper.open.test(xml)) continue

    const closeIndex = xml.toLowerCase().lastIndexOf(wrapper.close.toLowerCase())
    if (closeIndex === -1) continue

    const endIndex = closeIndex + wrapper.close.length
    const suffix = xml.slice(endIndex)
    if (/^(\s*<\/[^>]+>)*\s*$/.test(suffix)) {
      return xml.slice(0, endIndex)
    }
  }

  const lastSelfClose = xml.lastIndexOf('/>')
  const lastMxCellClose = xml.lastIndexOf('</mxCell>')
  const lastValidEnd = Math.max(lastSelfClose, lastMxCellClose)
  if (lastValidEnd === -1) return xml

  const endOffset = lastMxCellClose > lastSelfClose ? '</mxCell>'.length : 2
  const suffix = xml.slice(lastValidEnd + endOffset)
  if (/^(\s*<\/[^>]+>)*\s*$/.test(suffix)) {
    return xml.slice(0, lastValidEnd + endOffset)
  }

  return xml
}

function stripRootCells(xml: string): string {
  return xml
    .replace(/<mxCell\b(?=[^>]*\bid=["']0["'])[^>]*(?:\/>|>\s*<\/mxCell>)/gi, '')
    .replace(/<mxCell\b(?=[^>]*\bid=["']1["'])[^>]*(?:\/>|>\s*<\/mxCell>)/gi, '')
    .trim()
}

function extractRootInnerXml(xml: string): string {
  const rootMatch = xml.match(/<root[^>]*>([\s\S]*?)<\/root>/i)
  return rootMatch ? rootMatch[1].trim() : xml.replace(/<\/?root[^>]*>/gi, '').trim()
}

function wrapCellsWithMxFile(cellsXml: string, options: NormalizeDrawioXmlOptions = {}): string {
  const pageName = escapeXmlAttribute(options.pageName?.trim() || DEFAULT_PAGE_NAME)
  const pageId = escapeXmlAttribute(options.pageId?.trim() || DEFAULT_PAGE_ID)
  const cells = stripRootCells(stripProviderWrapperSuffix(cellsXml)).trim()

  return [
    '<mxfile host="Lingmo" agent="Lingmo" version="1.0">',
    `  <diagram name="${pageName}" id="${pageId}">`,
    `    <mxGraphModel ${DEFAULT_MX_GRAPH_MODEL_ATTRS}>`,
    '      <root>',
    '        <mxCell id="0" />',
    '        <mxCell id="1" parent="0" />',
    ...cells.split(/\r?\n/).map((line) => `        ${line.trim()}`).filter((line) => line.trim()),
    '      </root>',
    '    </mxGraphModel>',
    '  </diagram>',
    '</mxfile>',
  ].join('\n')
}

function wrapGraphModelWithMxFile(mxGraphModelXml: string, options: NormalizeDrawioXmlOptions = {}): string {
  const pageName = escapeXmlAttribute(options.pageName?.trim() || DEFAULT_PAGE_NAME)
  const pageId = escapeXmlAttribute(options.pageId?.trim() || DEFAULT_PAGE_ID)

  return [
    '<mxfile host="Lingmo" agent="Lingmo" version="1.0">',
    `  <diagram name="${pageName}" id="${pageId}">`,
    mxGraphModelXml.trim(),
    '  </diagram>',
    '</mxfile>',
  ].join('\n')
}

function getFirstRoot(doc: Document): Element | null {
  return doc.querySelector('mxGraphModel > root') || doc.querySelector('root')
}

function getDiagramRoots(doc: Document): Element[] {
  const roots = Array.from(doc.querySelectorAll('mxGraphModel > root'))
  if (roots.length > 0) return roots

  const root = doc.documentElement?.tagName === 'root'
    ? doc.documentElement
    : doc.querySelector('root')

  return root ? [root] : []
}

function ensureRootCells(doc: Document): boolean {
  const root = getFirstRoot(doc)
  if (!root) return false

  const cells = Array.from(root.querySelectorAll('mxCell'))
  const hasZero = cells.some((cell) => cell.getAttribute('id') === '0')
  const hasOne = cells.some((cell) => cell.getAttribute('id') === '1')
  let changed = false

  if (!hasZero) {
    const cell0 = doc.createElement('mxCell')
    cell0.setAttribute('id', '0')
    root.insertBefore(cell0, root.firstChild)
    changed = true
  }

  if (!hasOne) {
    const cell1 = doc.createElement('mxCell')
    cell1.setAttribute('id', '1')
    cell1.setAttribute('parent', '0')
    const cell0 = Array.from(root.querySelectorAll('mxCell')).find((cell) => cell.getAttribute('id') === '0')
    if (cell0?.nextSibling) {
      root.insertBefore(cell1, cell0.nextSibling)
    } else {
      root.appendChild(cell1)
    }
    changed = true
  }

  return changed
}

export function isMxCellXmlComplete(xml: string | undefined | null): boolean {
  const trimmed = xml?.trim() || ''
  if (!trimmed) return false

  const lastSelfClose = trimmed.lastIndexOf('/>')
  const lastMxCellClose = trimmed.lastIndexOf('</mxCell>')
  const lastValidEnd = Math.max(lastSelfClose, lastMxCellClose)
  if (lastValidEnd === -1) return false

  const endOffset = lastMxCellClose > lastSelfClose ? '</mxCell>'.length : 2
  const suffix = trimmed.slice(lastValidEnd + endOffset)
  return /^(\s*<\/[^>]+>)*\s*$/.test(suffix)
}

export function extractCompleteMxCells(xml: string | undefined | null): string {
  if (!xml) return ''

  const completeCells: Array<{ index: number; text: string }> = []
  const selfClosingPattern = /<mxCell\b[^>]*\/>/g
  const nestedPattern = /<mxCell\b[^>]*>[\s\S]*?<\/mxCell>/g
  let match: RegExpExecArray | null

  while ((match = selfClosingPattern.exec(xml)) !== null) {
    completeCells.push({ index: match.index, text: match[0] })
  }

  while ((match = nestedPattern.exec(xml)) !== null) {
    completeCells.push({ index: match.index, text: match[0] })
  }

  const seen = new Set<number>()
  return completeCells
    .sort((a, b) => a.index - b.index)
    .filter((cell) => {
      if (seen.has(cell.index)) return false
      seen.add(cell.index)
      return true
    })
    .map((cell) => cell.text)
    .join('\n')
}

export function normalizeDrawioXml(xml: string, options: NormalizeDrawioXmlOptions = {}): NormalizeDrawioXmlResult {
  const warnings: string[] = []
  const { fixed, fixes } = fixCommonXmlText(xml)
  let content = fixed
  let incomplete = false

  const shouldCheckCellCompleteness = !/<mxfile\b/i.test(content) && /<mxCell\b/i.test(content)
  if (shouldCheckCellCompleteness && !isMxCellXmlComplete(content)) {
    incomplete = true
    const completeCells = extractCompleteMxCells(content)
    if (options.rejectIncompleteCells) {
      throw new Error('Draw.io mxCell XML appears truncated. Complete the last mxCell or continue generation before saving.')
    }
    if (completeCells) {
      content = completeCells
      warnings.push('Input mxCell XML appeared truncated; only complete mxCell elements were kept.')
    }
  }

  if (!content.trim()) {
    content = wrapCellsWithMxFile('', options)
  } else if (/<mxfile\b/i.test(content)) {
    content = stripProviderWrapperSuffix(content)
  } else if (/<mxGraphModel\b/i.test(content)) {
    content = wrapGraphModelWithMxFile(content, options)
    warnings.push('Wrapped mxGraphModel in mxfile.')
  } else if (/<root\b/i.test(content)) {
    content = wrapCellsWithMxFile(extractRootInnerXml(content), options)
    warnings.push('Wrapped root cells in mxfile.')
  } else if (/<mxCell\b/i.test(content)) {
    content = wrapCellsWithMxFile(content, options)
    warnings.push('Wrapped bare mxCell elements in mxfile.')
  } else {
    throw new Error('Draw.io content must include mxfile, mxGraphModel, root, or mxCell XML.')
  }

  const doc = parseXml(content)
  if (ensureRootCells(doc)) {
    warnings.push('Added missing draw.io root cells id="0" and/or id="1".')
    content = serializeXml(doc)
  }

  return {
    xml: content,
    warnings,
    fixes,
    incomplete,
  }
}

export function validateDrawioXml(xml: string): string | null {
  try {
    normalizeDrawioXml(xml)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function getGeometry(cell: Element): Element | null {
  return cell.querySelector('mxGeometry[as="geometry"]') || cell.querySelector('mxGeometry')
}

function readNumberAttr(element: Element, attr: string, fallback = 0): number {
  const value = element.getAttribute(attr)
  if (value == null || value === '') return fallback
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getVertexBounds(cell: Element): VertexBounds | null {
  const geometry = getGeometry(cell)
  if (!geometry) return null

  const width = readNumberAttr(geometry, 'width')
  const height = readNumberAttr(geometry, 'height')
  if (width <= 0 || height <= 0) return null

  return {
    id: cell.getAttribute('id') || '',
    x: readNumberAttr(geometry, 'x'),
    y: readNumberAttr(geometry, 'y'),
    width,
    height,
  }
}

function getOverlapRatio(a: VertexBounds, b: VertexBounds): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const area = xOverlap * yOverlap
  if (area <= 0) return 0

  const smallerArea = Math.min(a.width * a.height, b.width * b.height)
  return smallerArea > 0 ? area / smallerArea : 0
}

export function inspectDrawioXml(xml: string): DrawioInspectionResult {
  const issues: DrawioInspectionIssue[] = []
  const warnings: DrawioInspectionIssue[] = []
  const stats: DrawioInspectionStats = {
    pages: 0,
    cells: 0,
    vertices: 0,
    edges: 0,
    groups: 0,
    duplicateIds: 0,
    missingGeometry: 0,
    invalidEdges: 0,
    overlaps: 0,
  }

  let normalized: NormalizeDrawioXmlResult
  try {
    normalized = normalizeDrawioXml(xml)
  } catch (error) {
    issues.push({
      code: 'parse_error',
      message: error instanceof Error ? error.message : String(error),
    })
    return {
      valid: false,
      issues,
      warnings,
      stats,
      fixes: [],
    }
  }

  for (const message of normalized.warnings) {
    warnings.push({ code: 'normalization_warning', message })
  }

  let doc: Document
  try {
    doc = parseXml(normalized.xml)
  } catch (error) {
    issues.push({
      code: 'parse_error',
      message: error instanceof Error ? error.message : String(error),
    })
    return {
      valid: false,
      issues,
      warnings,
      stats,
      normalizedXml: normalized.xml,
      fixes: normalized.fixes,
    }
  }

  const roots = getDiagramRoots(doc)
  stats.pages = roots.length

  if (roots.length === 0) {
    issues.push({
      code: 'missing_root',
      message: 'Could not find a draw.io <root> element. Encoded draw.io diagrams are not editable by cell id yet.',
    })
  }

  for (const root of roots) {
    const cells = Array.from(root.querySelectorAll('mxCell'))
    const cellMap = new Map<string, Element>()
    const idCounts = new Map<string, number>()

    stats.cells += cells.length

    for (const cell of cells) {
      const id = cell.getAttribute('id')?.trim()
      if (!id) {
        issues.push({
          code: 'missing_id',
          message: 'Every mxCell should have an id.',
        })
        continue
      }

      idCounts.set(id, (idCounts.get(id) || 0) + 1)
      if (!cellMap.has(id)) {
        cellMap.set(id, cell)
      }
    }

    for (const [id, count] of idCounts.entries()) {
      if (count <= 1) continue
      stats.duplicateIds += count - 1
      issues.push({
        code: 'duplicate_id',
        cellId: id,
        message: `Cell id "${id}" is used ${count} times in the same page.`,
      })
    }

    if (!cellMap.has('0')) {
      issues.push({
        code: 'missing_root_cell',
        cellId: '0',
        message: 'Missing draw.io root cell id="0".',
      })
    }

    if (!cellMap.has('1')) {
      issues.push({
        code: 'missing_root_cell',
        cellId: '1',
        message: 'Missing draw.io layer cell id="1".',
      })
    }

    const realCells = cells.filter((cell) => {
      const id = cell.getAttribute('id')
      return id !== '0' && id !== '1'
    })

    if (realCells.length === 0) {
      warnings.push({
        code: 'empty_diagram',
        message: 'Diagram has no real content cells beyond draw.io root cells.',
      })
    }

    const bounds: VertexBounds[] = []
    for (const cell of realCells) {
      const id = cell.getAttribute('id') || ''
      const isVertex = cell.getAttribute('vertex') === '1'
      const isEdge = cell.getAttribute('edge') === '1'

      if (isVertex) {
        stats.vertices += 1
        if ((cell.getAttribute('style') || '').includes('group')) {
          stats.groups += 1
        }

        const geometry = getGeometry(cell)
        if (!geometry) {
          stats.missingGeometry += 1
          issues.push({
            code: 'missing_geometry',
            cellId: id,
            message: `Vertex cell "${id}" is missing mxGeometry.`,
          })
          continue
        }

        const bound = getVertexBounds(cell)
        if (!bound) {
          stats.missingGeometry += 1
          issues.push({
            code: 'invalid_geometry',
            cellId: id,
            message: `Vertex cell "${id}" needs positive width and height in mxGeometry.`,
          })
          continue
        }

        if (!cell.getAttribute('parent')) {
          warnings.push({
            code: 'missing_parent',
            cellId: id,
            message: `Vertex cell "${id}" does not declare a parent layer.`,
          })
        }

        if (cell.getAttribute('parent') === '1') {
          bounds.push(bound)
        }
      }

      if (isEdge) {
        stats.edges += 1
        const source = cell.getAttribute('source')
        const target = cell.getAttribute('target')

        if (!getGeometry(cell)) {
          warnings.push({
            code: 'edge_missing_geometry',
            cellId: id,
            message: `Edge cell "${id}" has no mxGeometry.`,
          })
        }

        if (!source || !target) {
          warnings.push({
            code: 'edge_missing_endpoint',
            cellId: id,
            message: `Edge cell "${id}" should declare source and target when it connects shapes.`,
          })
        }

        if (source && !cellMap.has(source)) {
          stats.invalidEdges += 1
          issues.push({
            code: 'edge_missing_source',
            cellId: id,
            relatedCellId: source,
            message: `Edge cell "${id}" references missing source "${source}".`,
          })
        }

        if (target && !cellMap.has(target)) {
          stats.invalidEdges += 1
          issues.push({
            code: 'edge_missing_target',
            cellId: id,
            relatedCellId: target,
            message: `Edge cell "${id}" references missing target "${target}".`,
          })
        }
      }
    }

    for (let i = 0; i < bounds.length; i += 1) {
      for (let j = i + 1; j < bounds.length; j += 1) {
        const ratio = getOverlapRatio(bounds[i], bounds[j])
        if (ratio < 0.35) continue

        stats.overlaps += 1
        warnings.push({
          code: 'possible_overlap',
          cellId: bounds[i].id,
          relatedCellId: bounds[j].id,
          message: `Cells "${bounds[i].id}" and "${bounds[j].id}" appear to overlap.`,
        })
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    stats,
    normalizedXml: normalized.xml,
    fixes: normalized.fixes,
  }
}

function parseSingleMxCell(xml: string): { cell?: Element; error?: string } {
  try {
    const { fixed } = fixCommonXmlText(xml)
    const doc = parseXml(`<wrapper>${fixed}</wrapper>`)
    const topLevelCells = Array.from(doc.documentElement.children).filter((node): node is Element => node.tagName === 'mxCell')
    const cells = Array.from(doc.documentElement.querySelectorAll('mxCell'))
    if (cells.length === 0) {
      return { error: 'new_xml must contain one mxCell element.' }
    }
    if (topLevelCells.length !== 1) {
      return { error: 'new_xml must contain exactly one top-level mxCell element.' }
    }
    if (cells[0].querySelector('mxCell')) {
      return { error: 'mxCell elements must be siblings; nested mxCell elements are not supported.' }
    }
    return { cell: topLevelCells[0] }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function parseMxCellFragment(xml: string): { cells: Element[]; error?: string; incomplete: boolean } {
  try {
    const { fixed } = fixCommonXmlText(xml)
    const incomplete = /<mxCell\b/i.test(fixed) && !isMxCellXmlComplete(fixed)
    if (incomplete) {
      return {
        cells: [],
        error: 'Draw.io mxCell XML appears truncated. Complete the last mxCell before appending.',
        incomplete,
      }
    }

    const doc = parseXml(`<wrapper>${fixed}</wrapper>`)
    const cells = Array.from(doc.documentElement.children).filter((node): node is Element => node.tagName === 'mxCell')
    if (cells.length === 0) {
      return { cells: [], error: 'cellsXml must contain mxCell elements.', incomplete }
    }
    if (cells.some((cell) => cell.querySelector('mxCell'))) {
      return { cells: [], error: 'mxCell elements must be siblings; nested mxCell elements are not supported.', incomplete }
    }
    return { cells, incomplete }
  } catch (error) {
    return {
      cells: [],
      error: error instanceof Error ? error.message : String(error),
      incomplete: false,
    }
  }
}

function getCellMap(root: Element): Map<string, Element> {
  const map = new Map<string, Element>()
  root.querySelectorAll('mxCell').forEach((cell) => {
    const id = cell.getAttribute('id')
    if (id) map.set(id, cell)
  })
  return map
}

function collectDescendantCellIds(root: Element, cellId: string, cellsToDelete: Set<string>): void {
  if (cellsToDelete.has(cellId)) return
  cellsToDelete.add(cellId)

  root.querySelectorAll('mxCell').forEach((cell) => {
    const childId = cell.getAttribute('id')
    if (childId && childId !== '0' && childId !== '1' && cell.getAttribute('parent') === cellId) {
      collectDescendantCellIds(root, childId, cellsToDelete)
    }
  })
}

export function applyDrawioCellOperations(
  xmlContent: string,
  operations: DrawioCellOperation[],
): ApplyDrawioOperationsResult {
  const errors: DrawioOperationError[] = []

  let normalized: NormalizeDrawioXmlResult
  try {
    normalized = normalizeDrawioXml(xmlContent)
  } catch (error) {
    return {
      xml: xmlContent,
      warnings: [],
      errors: [{
        type: 'update',
        cellId: '',
        message: error instanceof Error ? error.message : String(error),
      }],
    }
  }

  let doc: Document
  try {
    doc = parseXml(normalized.xml)
  } catch (error) {
    return {
      xml: normalized.xml,
      warnings: normalized.warnings,
      errors: [{
        type: 'update',
        cellId: '',
        message: error instanceof Error ? error.message : String(error),
      }],
    }
  }

  const root = getFirstRoot(doc)
  if (!root) {
    return {
      xml: normalized.xml,
      warnings: normalized.warnings,
      errors: [{
        type: 'update',
        cellId: '',
        message: 'Could not find a draw.io <root> element. Encoded draw.io diagrams are not editable by cell id yet.',
      }],
    }
  }

  let cellMap = getCellMap(root)

  for (const op of operations) {
    const cellId = op.cell_id?.trim()
    if (!cellId) {
      errors.push({ type: op.operation, cellId: '', message: 'cell_id is required.' })
      continue
    }

    if (op.operation === 'update') {
      const existingCell = cellMap.get(cellId)
      if (!existingCell) {
        errors.push({ type: 'update', cellId, message: `Cell with id="${cellId}" was not found.` })
        continue
      }

      const parsed = parseSingleMxCell(op.new_xml || '')
      if (!parsed.cell) {
        errors.push({ type: 'update', cellId, message: parsed.error || 'Invalid new_xml.' })
        continue
      }
      if (parsed.cell.getAttribute('id') !== cellId) {
        errors.push({
          type: 'update',
          cellId,
          message: `ID mismatch: cell_id is "${cellId}" but new_xml has id="${parsed.cell.getAttribute('id') || ''}".`,
        })
        continue
      }

      const importedNode = doc.importNode(parsed.cell, true) as Element
      existingCell.parentNode?.replaceChild(importedNode, existingCell)
      cellMap = getCellMap(root)
      continue
    }

    if (op.operation === 'add') {
      if (cellMap.has(cellId)) {
        errors.push({ type: 'add', cellId, message: `Cell with id="${cellId}" already exists.` })
        continue
      }

      const parsed = parseSingleMxCell(op.new_xml || '')
      if (!parsed.cell) {
        errors.push({ type: 'add', cellId, message: parsed.error || 'Invalid new_xml.' })
        continue
      }
      if (parsed.cell.getAttribute('id') !== cellId) {
        errors.push({
          type: 'add',
          cellId,
          message: `ID mismatch: cell_id is "${cellId}" but new_xml has id="${parsed.cell.getAttribute('id') || ''}".`,
        })
        continue
      }

      root.appendChild(doc.importNode(parsed.cell, true))
      cellMap = getCellMap(root)
      continue
    }

    if (op.operation === 'delete') {
      if (cellId === '0' || cellId === '1') {
        errors.push({ type: 'delete', cellId, message: `Cannot delete draw.io root cell "${cellId}".` })
        continue
      }

      if (!cellMap.has(cellId)) {
        continue
      }

      const cellsToDelete = new Set<string>()
      collectDescendantCellIds(root, cellId, cellsToDelete)

      let changed = true
      while (changed) {
        changed = false
        root.querySelectorAll('mxCell').forEach((cell) => {
          const id = cell.getAttribute('id')
          if (!id || id === '0' || id === '1' || cellsToDelete.has(id)) return
          if (cellsToDelete.has(cell.getAttribute('source') || '') || cellsToDelete.has(cell.getAttribute('target') || '')) {
            collectDescendantCellIds(root, id, cellsToDelete)
            changed = true
          }
        })
      }

      for (const id of cellsToDelete) {
        const cell = cellMap.get(id)
        cell?.parentNode?.removeChild(cell)
      }
      cellMap = getCellMap(root)
    }
  }

  return {
    xml: errors.length > 0 ? normalized.xml : serializeXml(doc),
    errors,
    warnings: normalized.warnings,
  }
}

export function appendDrawioCellsToXml(xmlContent: string, cellsXml: string): ApplyDrawioOperationsResult {
  const normalized = normalizeDrawioXml(xmlContent)
  const parsed = parseMxCellFragment(cellsXml)
  if (parsed.error) {
    return {
      xml: normalized.xml,
      warnings: normalized.warnings,
      errors: [{ type: 'add', cellId: '', message: parsed.error }],
    }
  }

  const doc = parseXml(normalized.xml)
  const root = getFirstRoot(doc)
  if (!root) {
    return {
      xml: normalized.xml,
      warnings: normalized.warnings,
      errors: [{ type: 'add', cellId: '', message: 'Could not find a draw.io <root> element.' }],
    }
  }

  const existingIds = getCellMap(root)
  const newIds = new Set<string>()
  const errors: DrawioOperationError[] = []

  for (const cell of parsed.cells) {
    const id = cell.getAttribute('id')?.trim()
    if (!id) {
      errors.push({ type: 'add', cellId: '', message: 'Every appended mxCell needs an id.' })
      continue
    }
    if (id === '0' || id === '1') {
      continue
    }
    if (existingIds.has(id) || newIds.has(id)) {
      errors.push({ type: 'add', cellId: id, message: `Cell with id="${id}" already exists.` })
      continue
    }
    newIds.add(id)
  }

  if (errors.length > 0) {
    return { xml: normalized.xml, warnings: normalized.warnings, errors }
  }

  for (const cell of parsed.cells) {
    const id = cell.getAttribute('id')
    if (id === '0' || id === '1') continue
    root.appendChild(doc.importNode(cell, true))
  }

  return {
    xml: serializeXml(doc),
    warnings: normalized.warnings,
    errors: [],
  }
}
