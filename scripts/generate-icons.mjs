/**
 * 图标生成脚本
 * 
 * 使用方法：
 * 1. 安装依赖：pnpm add -D @resvg/resvg-js
 * 2. 运行：node scripts/generate-icons.mjs
 * 
 * 或者手动方式：
 * 用浏览器打开 public/app-icon.svg，截图保存为不同尺寸的 PNG
 * 替换 src-tauri/icons/ 下的所有 PNG 文件
 * 替换 public/app-icon.png 和 public/app-ios-icon.png
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

// SVG 源文件 — 从 public/app-icon.svg 读取
const svgContent = readFileSync(join(rootDir, 'public/app-icon.svg'), 'utf8')

// 需要生成的尺寸
const sizes = [
  { name: 'src-tauri/icons/32x32.png', size: 32 },
  { name: 'src-tauri/icons/64x64.png', size: 64 },
  { name: 'src-tauri/icons/128x128.png', size: 128 },
  { name: 'src-tauri/icons/128x128@2x.png', size: 256 },
  { name: 'src-tauri/icons/icon.png', size: 512 },
  { name: 'src-tauri/icons/icon_ios.png', size: 1024 },
  { name: 'src-tauri/icons/Square30x30Logo.png', size: 30 },
  { name: 'src-tauri/icons/Square44x44Logo.png', size: 44 },
  { name: 'src-tauri/icons/Square71x71Logo.png', size: 71 },
  { name: 'src-tauri/icons/Square89x89Logo.png', size: 89 },
  { name: 'src-tauri/icons/Square107x107Logo.png', size: 107 },
  { name: 'src-tauri/icons/Square142x142Logo.png', size: 142 },
  { name: 'src-tauri/icons/Square150x150Logo.png', size: 150 },
  { name: 'src-tauri/icons/Square284x284Logo.png', size: 284 },
  { name: 'src-tauri/icons/Square310x310Logo.png', size: 310 },
  { name: 'src-tauri/icons/StoreLogo.png', size: 50 },
  { name: 'public/app-icon.png', size: 512 },
  { name: 'public/app-ios-icon.png', size: 1024 },
]

async function main() {
  try {
    const { Resvg } = await import('@resvg/resvg-js')

    for (const { name, size } of sizes) {
      const resvg = new Resvg(svgContent, {
        fitTo: { mode: 'width', value: size },
      })
      const pngData = resvg.render()
      const pngBuffer = pngData.asPng()
      const outputPath = join(rootDir, name)
      writeFileSync(outputPath, pngBuffer)
      console.log(`✓ Generated ${name} (${size}x${size})`)
    }

    console.log('\n✓ All icons generated successfully!')
    console.log('\nNote: For .ico and .icns files, use online converters:')
    console.log('  - ICO: https://convertio.co/png-ico/')
    console.log('  - ICNS: https://cloudconvert.com/png-to-icns')
    console.log('  Use the 512x512 PNG as source.')
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('Error: @resvg/resvg-js not installed.')
      console.error('Run: pnpm add -D @resvg/resvg-js')
      console.error('')
      console.error('Alternative: Open public/app-icon.svg in browser and manually export PNGs.')
    } else {
      console.error('Error:', error)
    }
  }
}

main()
