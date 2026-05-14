/**
 * 生成 Windows 兼容的 ICO 文件
 * ICO 格式要求：小尺寸用 BMP（DIB），256x256 可以用 PNG
 */
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const svg = readFileSync(join(rootDir, 'public/app-icon.svg'), 'utf8')

// 将 PNG 转为 32-bit BGRA BMP (DIB) 格式（无文件头，只有 BITMAPINFOHEADER + 像素数据）
function pngToDib(pngBuffer, size) {
  // 解码 PNG 获取 RGBA 像素
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
  const rendered = resvg.render()
  const width = rendered.width
  const height = rendered.height
  const pixels = rendered.pixels // Uint8Array RGBA

  // BMP DIB: BITMAPINFOHEADER (40 bytes) + pixel data (bottom-up, BGRA)
  const headerSize = 40
  const rowSize = width * 4 // 32-bit = 4 bytes per pixel
  const pixelDataSize = rowSize * height
  // AND mask: 1-bit per pixel, rows padded to 4 bytes
  const andRowSize = Math.ceil(width / 32) * 4
  const andMaskSize = andRowSize * height

  const dibSize = headerSize + pixelDataSize + andMaskSize
  const dib = Buffer.alloc(dibSize)

  // BITMAPINFOHEADER
  dib.writeUInt32LE(40, 0)           // biSize
  dib.writeInt32LE(width, 4)         // biWidth
  dib.writeInt32LE(height * 2, 8)    // biHeight (doubled for ICO: includes AND mask)
  dib.writeUInt16LE(1, 12)           // biPlanes
  dib.writeUInt16LE(32, 14)          // biBitCount
  dib.writeUInt32LE(0, 16)           // biCompression (BI_RGB)
  dib.writeUInt32LE(pixelDataSize + andMaskSize, 20) // biSizeImage
  // Rest of header is zeros (already allocated)

  // Pixel data: convert RGBA (top-down) to BGRA (bottom-up)
  for (let y = 0; y < height; y++) {
    const srcRow = y * width * 4
    const dstRow = (height - 1 - y) * rowSize + headerSize
    for (let x = 0; x < width; x++) {
      const srcIdx = srcRow + x * 4
      const dstIdx = dstRow + x * 4
      dib[dstIdx + 0] = pixels[srcIdx + 2] // B
      dib[dstIdx + 1] = pixels[srcIdx + 1] // G
      dib[dstIdx + 2] = pixels[srcIdx + 0] // R
      dib[dstIdx + 3] = pixels[srcIdx + 3] // A
    }
  }

  // AND mask: all zeros (fully opaque, alpha channel handles transparency)
  // Already zeros from Buffer.alloc

  return { dib, width, height }
}

// 生成 ICO 文件
const sizes = [16, 32, 48]
const entries = []

for (const size of sizes) {
  const { dib, width, height } = pngToDib(null, size)
  entries.push({ size, width, height, data: dib })
}

// 256x256 用 PNG 格式（ICO 规范允许）
const resvg256 = new Resvg(svg, { fitTo: { mode: 'width', value: 256 } })
const png256 = resvg256.render().asPng()
entries.push({ size: 256, width: 256, height: 256, data: png256, isPng: true })

// 构建 ICO 文件
const ICONDIR_SIZE = 6
const ICONDIRENTRY_SIZE = 16
const headerTotalSize = ICONDIR_SIZE + entries.length * ICONDIRENTRY_SIZE
const totalSize = headerTotalSize + entries.reduce((s, e) => s + e.data.length, 0)

const ico = Buffer.alloc(totalSize)
let offset = 0

// ICONDIR
ico.writeUInt16LE(0, offset); offset += 2      // Reserved
ico.writeUInt16LE(1, offset); offset += 2      // Type (1 = ICO)
ico.writeUInt16LE(entries.length, offset); offset += 2  // Count

// ICONDIRENTRY for each image
let dataOffset = headerTotalSize
for (const entry of entries) {
  ico.writeUInt8(entry.size >= 256 ? 0 : entry.size, offset); offset++  // Width
  ico.writeUInt8(entry.size >= 256 ? 0 : entry.size, offset); offset++  // Height
  ico.writeUInt8(0, offset); offset++           // Color palette
  ico.writeUInt8(0, offset); offset++           // Reserved
  ico.writeUInt16LE(1, offset); offset += 2     // Color planes
  ico.writeUInt16LE(32, offset); offset += 2    // Bits per pixel
  ico.writeUInt32LE(entry.data.length, offset); offset += 4  // Size of image data
  ico.writeUInt32LE(dataOffset, offset); offset += 4         // Offset to image data
  dataOffset += entry.data.length
}

// Image data
for (const entry of entries) {
  entry.data.copy(ico, offset)
  offset += entry.data.length
}

writeFileSync(join(rootDir, 'src-tauri/icons/icon.ico'), ico)
console.log(`✓ Generated icon.ico (${entries.map(e => e.size + 'px').join(', ')})`)
