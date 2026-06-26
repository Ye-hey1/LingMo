import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = await mkdtemp(join(tmpdir(), 'lingmo-drawio-xml-tests-'))

class XmlNode {
  constructor() {
    this.parentNode = null
    this.children = []
    this._text = ''
  }

  get firstChild() {
    return this.children[0] || null
  }

  get nextSibling() {
    if (!this.parentNode) return null
    const index = this.parentNode.children.indexOf(this)
    return index >= 0 ? this.parentNode.children[index + 1] || null : null
  }

  get textContent() {
    return `${this._text}${this.children.map((child) => child.textContent).join('')}`
  }

  appendChild(child) {
    child.parentNode = this
    this.children.push(child)
    return child
  }

  insertBefore(child, referenceChild) {
    child.parentNode = this
    const index = referenceChild ? this.children.indexOf(referenceChild) : -1
    if (index === -1) {
      this.children.push(child)
    } else {
      this.children.splice(index, 0, child)
    }
    return child
  }

  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index !== -1) {
      this.children.splice(index, 1)
      child.parentNode = null
    }
    return child
  }

  replaceChild(newChild, oldChild) {
    const index = this.children.indexOf(oldChild)
    if (index === -1) return oldChild
    newChild.parentNode = this
    oldChild.parentNode = null
    this.children[index] = newChild
    return oldChild
  }
}

class XmlElement extends XmlNode {
  constructor(tagName) {
    super()
    this.tagName = tagName
    this.nodeName = tagName
    this.attributes = new Map()
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }

  querySelector(selector) {
    return querySelectorAll(this, selector)[0] || null
  }

  querySelectorAll(selector) {
    return querySelectorAll(this, selector)
  }
}

class XmlDocument extends XmlNode {
  constructor() {
    super()
    this.documentElement = null
  }

  appendChild(child) {
    super.appendChild(child)
    if (!this.documentElement) {
      this.documentElement = child
    }
    return child
  }

  createElement(tagName) {
    return new XmlElement(tagName)
  }

  importNode(node, deep = false) {
    return cloneElement(node, deep)
  }

  querySelector(selector) {
    return querySelectorAll(this, selector)[0] || null
  }

  querySelectorAll(selector) {
    return querySelectorAll(this, selector)
  }
}

function cloneElement(node, deep) {
  const clone = new XmlElement(node.tagName)
  clone._text = node._text
  for (const [name, value] of node.attributes.entries()) {
    clone.setAttribute(name, value)
  }
  if (deep) {
    for (const child of node.children) {
      clone.appendChild(cloneElement(child, true))
    }
  }
  return clone
}

function parseSelector(selector) {
  const match = selector.match(/^([A-Za-z0-9:_-]+)(?:\[([A-Za-z0-9:_-]+)=["']?([^"'\]]+)["']?\])?$/)
  if (!match) {
    throw new Error(`Unsupported test selector: ${selector}`)
  }
  return {
    tagName: match[1],
    attrName: match[2],
    attrValue: match[3],
  }
}

function matchesSelector(element, selector) {
  const parsed = parseSelector(selector)
  if (element.tagName !== parsed.tagName) return false
  if (!parsed.attrName) return true
  return element.getAttribute(parsed.attrName) === parsed.attrValue
}

function getSearchRoots(root) {
  if (root instanceof XmlDocument) {
    return root.documentElement ? [root.documentElement] : []
  }
  return root.children
}

function findDescendants(root, selector) {
  const matches = []
  const visit = (element) => {
    if (matchesSelector(element, selector)) {
      matches.push(element)
    }
    for (const child of element.children) {
      visit(child)
    }
  }

  for (const child of getSearchRoots(root)) {
    visit(child)
  }
  return matches
}

function querySelectorAll(root, selector) {
  const parts = selector.split('>').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return []
  if (parts.length === 1) {
    return findDescendants(root, parts[0])
  }

  let current = findDescendants(root, parts[0])
  for (const part of parts.slice(1)) {
    current = current.flatMap((element) => element.children.filter((child) => matchesSelector(child, part)))
  }
  return current
}

function decodeXmlText(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function escapeXmlText(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeXmlAttribute(value) {
  return escapeXmlText(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function parseAttributes(raw) {
  const attributes = new Map()
  const attrPattern = /([A-Za-z0-9:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let match
  while ((match = attrPattern.exec(raw)) !== null) {
    attributes.set(match[1], decodeXmlText(match[2] ?? match[3] ?? ''))
  }
  return attributes
}

function parseXmlDocument(xml) {
  const doc = new XmlDocument()
  const stack = [doc]
  const tokens = xml.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/[^>]+>|<[^>]+>|[^<]+/g) || []

  for (const token of tokens) {
    if (!token) continue
    if (token.startsWith('<!--') || token.startsWith('<?') || token.startsWith('<!')) {
      continue
    }
    if (!token.startsWith('<')) {
      const text = decodeXmlText(token)
      if (text.trim()) {
        stack[stack.length - 1]._text += text
      }
      continue
    }
    if (token.startsWith('</')) {
      const tagName = token.slice(2, -1).trim()
      const current = stack.pop()
      if (!(current instanceof XmlElement) || current.tagName !== tagName) {
        throw new Error(`Mismatched closing tag: ${tagName}`)
      }
      continue
    }

    const selfClosing = /\/\s*>$/.test(token)
    const inner = token
      .replace(/^</, '')
      .replace(selfClosing ? /\/\s*>$/ : />$/, '')
      .trim()
    const tagMatch = inner.match(/^([^\s/>]+)/)
    if (!tagMatch) {
      throw new Error(`Invalid opening tag: ${token}`)
    }

    const element = new XmlElement(tagMatch[1])
    const rawAttributes = inner.slice(tagMatch[1].length)
    for (const [name, value] of parseAttributes(rawAttributes).entries()) {
      element.setAttribute(name, value)
    }

    stack[stack.length - 1].appendChild(element)
    if (!selfClosing) {
      stack.push(element)
    }
  }

  if (stack.length !== 1) {
    const unclosed = stack[stack.length - 1]
    throw new Error(`Unclosed tag: ${unclosed.tagName || 'document'}`)
  }

  if (!doc.documentElement) {
    throw new Error('Missing document element.')
  }

  return doc
}

function parserErrorDocument(error) {
  const doc = new XmlDocument()
  const element = new XmlElement('parsererror')
  element._text = error instanceof Error ? error.message : String(error)
  doc.appendChild(element)
  return doc
}

function serializeNode(node) {
  if (node instanceof XmlDocument) {
    return node.documentElement ? serializeNode(node.documentElement) : ''
  }

  const attrs = Array.from(node.attributes.entries())
    .map(([name, value]) => ` ${name}="${escapeXmlAttribute(value)}"`)
    .join('')
  const content = `${escapeXmlText(node._text)}${node.children.map((child) => serializeNode(child)).join('')}`
  return content ? `<${node.tagName}${attrs}>${content}</${node.tagName}>` : `<${node.tagName}${attrs}/>`
}

globalThis.DOMParser = class TestDOMParser {
  parseFromString(xml) {
    try {
      return parseXmlDocument(xml)
    } catch (error) {
      return parserErrorDocument(error)
    }
  }
}

globalThis.XMLSerializer = class TestXMLSerializer {
  serializeToString(node) {
    return serializeNode(node)
  }
}

async function importTsModule(relativePath) {
  const sourcePath = join(repoRoot, relativePath)
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing source file: ${relativePath}`)
  }

  const source = await readFile(sourcePath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      esModuleInterop: true,
      strict: true,
    },
    fileName: sourcePath,
  }).outputText

  const outPath = join(tempDir, relativePath.replace(/\.tsx?$/, '.mjs'))
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, output, 'utf8')
  return import(pathToFileURL(outPath).href)
}

function drawioXml(cells) {
  return [
    '<mxfile host="Lingmo">',
    '  <diagram name="Page 1" id="page-1">',
    '    <mxGraphModel>',
    '      <root>',
    '        <mxCell id="0"/>',
    '        <mxCell id="1" parent="0"/>',
    cells.trim(),
    '      </root>',
    '    </mxGraphModel>',
    '  </diagram>',
    '</mxfile>',
  ].join('\n')
}

try {
  const { inspectDrawioXml, normalizeDrawioXml } = await importTsModule('src/lib/diagram/drawio-xml.ts')
  const {
    decodeDrawioSvgExportData,
    inspectDrawioExportedSvg,
    selectDrawioExportData,
  } = await importTsModule('src/lib/diagram/drawio-export.ts')

  test('accepts a valid draw.io graph with connected vertices', () => {
    const result = inspectDrawioXml(drawioXml(`
      <mxCell id="source" value="Source" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
        <mxGeometry x="80" y="100" width="120" height="60" as="geometry"/>
      </mxCell>
      <mxCell id="target" value="Target" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
        <mxGeometry x="300" y="100" width="120" height="60" as="geometry"/>
      </mxCell>
      <mxCell id="edge-1" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="source" target="target">
        <mxGeometry relative="1" as="geometry"/>
      </mxCell>
    `))

    assert.equal(result.valid, true)
    assert.equal(result.stats.pages, 1)
    assert.equal(result.stats.vertices, 2)
    assert.equal(result.stats.edges, 1)
    assert.equal(result.stats.invalidEdges, 0)
    assert.equal(result.stats.missingGeometry, 0)
    assert.equal(result.stats.duplicateIds, 0)
  })

  test('reports duplicate cell ids as structural errors', () => {
    const result = inspectDrawioXml(drawioXml(`
      <mxCell id="duplicate" value="A" vertex="1" parent="1">
        <mxGeometry x="80" y="100" width="120" height="60" as="geometry"/>
      </mxCell>
      <mxCell id="duplicate" value="B" vertex="1" parent="1">
        <mxGeometry x="260" y="100" width="120" height="60" as="geometry"/>
      </mxCell>
    `))

    assert.equal(result.valid, false)
    assert.equal(result.stats.duplicateIds, 1)
    assert.equal(result.issues.some((issue) => issue.code === 'duplicate_id' && issue.cellId === 'duplicate'), true)
  })

  test('reports edges that reference missing endpoints', () => {
    const result = inspectDrawioXml(drawioXml(`
      <mxCell id="source" value="Source" vertex="1" parent="1">
        <mxGeometry x="80" y="100" width="120" height="60" as="geometry"/>
      </mxCell>
      <mxCell id="broken-edge" edge="1" parent="1" source="source" target="missing-target">
        <mxGeometry relative="1" as="geometry"/>
      </mxCell>
    `))

    assert.equal(result.valid, false)
    assert.equal(result.stats.invalidEdges, 1)
    assert.equal(result.issues.some((issue) => (
      issue.code === 'edge_missing_target' &&
      issue.cellId === 'broken-edge' &&
      issue.relatedCellId === 'missing-target'
    )), true)
  })

  test('reports vertex cells without geometry', () => {
    const result = inspectDrawioXml(drawioXml(`
      <mxCell id="shape-without-geometry" value="No geometry" vertex="1" parent="1"/>
    `))

    assert.equal(result.valid, false)
    assert.equal(result.stats.missingGeometry, 1)
    assert.equal(result.issues.some((issue) => (
      issue.code === 'missing_geometry' &&
      issue.cellId === 'shape-without-geometry'
    )), true)
  })

  test('warns about likely overlapping top-level vertices', () => {
    const result = inspectDrawioXml(drawioXml(`
      <mxCell id="shape-a" value="A" vertex="1" parent="1">
        <mxGeometry x="80" y="100" width="120" height="60" as="geometry"/>
      </mxCell>
      <mxCell id="shape-b" value="B" vertex="1" parent="1">
        <mxGeometry x="90" y="105" width="120" height="60" as="geometry"/>
      </mxCell>
    `))

    assert.equal(result.valid, true)
    assert.equal(result.stats.overlaps, 1)
    assert.equal(result.warnings.some((warning) => (
      warning.code === 'possible_overlap' &&
      warning.cellId === 'shape-a' &&
      warning.relatedCellId === 'shape-b'
    )), true)
  })

  test('keeps complete wrappers while trimming provider wrapper suffixes from cell fragments', () => {
    const complete = normalizeDrawioXml(drawioXml(`
      <mxCell id="shape-a" value="A" vertex="1" parent="1">
        <mxGeometry x="80" y="100" width="120" height="60" as="geometry"/>
      </mxCell>
    `))

    assert.match(complete.xml, /<\/root>\s*<\/mxGraphModel>\s*<\/diagram>\s*<\/mxfile>/)
    assert.equal(inspectDrawioXml(complete.xml).valid, true)

    const fragment = normalizeDrawioXml(`
      <mxCell id="shape-a" value="A" vertex="1" parent="1">
        <mxGeometry x="80" y="100" width="120" height="60" as="geometry"/>
      </mxCell>
      </root></mxGraphModel></diagram></mxfile>
    `)

    assert.equal(inspectDrawioXml(fragment.xml).valid, true)
    assert.equal((fragment.xml.match(/<mxCell id="shape-a"/g) || []).length, 1)
  })

  test('decodes draw.io SVG data URLs and inspects visible exported content', () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="120px" height="60px" viewBox="0 0 120 60">',
      '<g data-cell-id="cell-1">',
      '<rect x="10" y="10" width="100" height="40" fill="#fff" stroke="#000"/>',
      '<text x="60" y="35" text-anchor="middle">Agent</text>',
      '</g>',
      '</svg>',
    ].join('')
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`

    assert.equal(decodeDrawioSvgExportData(dataUrl), svg)

    const inspection = inspectDrawioExportedSvg(svg)
    assert.equal(inspection.valid, true)
    assert.equal(inspection.width, 120)
    assert.equal(inspection.height, 60)
    assert.equal(inspection.drawioCellCount, 1)
    assert.equal(inspection.visibleElementCount >= 2, true)
  })

  test('rejects blank SVG exports before they are saved', () => {
    const blankSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60"><defs/><g/></svg>'
    const fallbackOnlySvg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60">',
      '<a xlink:href="https://www.drawio.com/doc/faq/svg-export-text-problems">',
      '<text x="50%" y="100%">Text is not SVG - cannot display</text>',
      '</a>',
      '</svg>',
    ].join('')

    const blankInspection = inspectDrawioExportedSvg(blankSvg)
    assert.equal(blankInspection.valid, false)
    assert.equal(blankInspection.issues.includes('missing-visible-elements'), true)

    const fallbackInspection = inspectDrawioExportedSvg(fallbackOnlySvg)
    assert.equal(fallbackInspection.valid, false)
    assert.equal(fallbackInspection.issues.includes('missing-visible-elements'), true)
  })

  test('prefers the draw.io svg response field when data is not SVG', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'

    assert.equal(selectDrawioExportData({ data: 'not svg', svg }, 'svg'), svg)
    assert.equal(selectDrawioExportData({ data: 'data:image/png;base64,AAAA', svg }, 'xmlsvg'), svg)
    assert.equal(selectDrawioExportData({ data: 'data:image/png;base64,AAAA', svg }, 'png'), 'data:image/png;base64,AAAA')
  })
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
