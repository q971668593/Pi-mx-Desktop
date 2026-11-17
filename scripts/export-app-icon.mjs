/**
 * 从 resources/icon.svg 导出 build/icon.png (1024) 与 build/icon.ico (多尺寸) 供打包与运行时图标
 * 需要: npm i -D sharp
 * 运行: node scripts/export-app-icon.mjs
 */
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const customPngPath = join(root, 'resources', 'pi-mx-icon.png')
const svgPath = join(root, 'resources', 'icon.svg')
const outDir = join(root, 'build')
const outPng = join(outDir, 'icon.png')
const outIco = join(outDir, 'icon.ico')

/**
 * Windows 会按显示尺寸挑 .ico 里的图像；只放 256 时系统必须缩放，
 * 小尺寸下会发虚并把圆角外的透明压成暗色（看起来像黑边）。
 * 因此写入 16/24/32/48/64/128/256 全套 PNG 压缩图像。
 */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

function pngToIco(pngBuffers) {
  const count = pngBuffers.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // Reserved
  header.writeUInt16LE(1, 2) // Type: icon
  header.writeUInt16LE(count, 4) // Count

  const entries = []
  let offset = 6 + count * 16
  for (const { size, buffer } of pngBuffers) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // Width: 0 表示 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1) // Height
    entry.writeUInt8(0, 2) // Colors
    entry.writeUInt8(0, 3) // Reserved
    entry.writeUInt16LE(1, 4) // Planes
    entry.writeUInt16LE(32, 6) // Bit count
    entry.writeUInt32LE(buffer.length, 8) // Bytes in res
    entry.writeUInt32LE(offset, 12) // Offset
    entries.push(entry)
    offset += buffer.length
  }

  return Buffer.concat([header, ...entries, ...pngBuffers.map((entry) => entry.buffer)])
}

async function main() {
  let sharp
  try {
    sharp = (await import('sharp')).default
  } catch {
    console.error('请先安装: npm i -D sharp')
    process.exit(1)
  }
  const source = existsSync(customPngPath)
    ? await readFile(customPngPath)
    : await readFile(svgPath)
  await mkdir(outDir, { recursive: true })

  const pipeline = existsSync(customPngPath) ? sharp(source) : sharp(source, { density: 300 })
  await pipeline.clone().resize(1024, 1024).png().toFile(outPng)
  console.log('Wrote', outPng)

  const images = []
  for (const size of ICO_SIZES) {
    images.push({ size, buffer: await pipeline.clone().resize(size, size).png().toBuffer() })
  }
  await writeFile(outIco, pngToIco(images))
  console.log('Wrote', outIco, `(${ICO_SIZES.join(', ')})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
