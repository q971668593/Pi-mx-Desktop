/**
 * 重建被压平的图标 alpha 通道。
 *
 * 背景：resources/pi-mx-icon.png 是从设计稿压平出来的 RGB PNG，圆角之外原本应该是
 * 透明区域，但压平时被合成了纯黑。Windows 于是把整张 1024×1024 当成实心矩形，
 * 桌面/任务栏/安装包图标上就出现一圈黑边。
 *
 * 做法：不猜圆角半径，直接从像素本身恢复。
 *   1. 每一行找出轮廓的左右边界（第一个/最后一个非黑像素）。
 *   2. 边界附近几像素是设计稿压平时与黑底混合出来的过渡带，满足 pixel = alpha × FG
 *      （FG 是明亮的描边），所以 alpha ≈ 该像素的亮度；直接把它当作 alpha 就还原了
 *      抗锯齿边缘，不会留下硬边。
 *   3. 边界之外 alpha = 0（真透明）。
 *
 * 用法: node scripts/fix-icon-alpha.mjs [文件...]   默认处理仓库里的两个图标源文件
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 低于此亮度视为「设计稿里不存在」的纯黑。 */
const BLACK_LEVEL = 6
/** 边界过渡带宽度（像素）：超过这个距离就是实心内容，alpha 直接给满。 */
const RAMP_PIXELS = 8

function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * @param {Buffer} raw RGBA 原始像素
 * @param {number} width
 * @param {number} height
 * @returns {Buffer} 带 alpha 的 RGBA
 */
function restoreAlpha(raw, width, height) {
  const out = Buffer.from(raw)
  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4
    // 1. 轮廓边界
    let left = -1
    let right = -1
    for (let x = 0; x < width; x++) {
      const i = rowStart + x * 4
      if (luminance(out[i], out[i + 1], out[i + 2]) > BLACK_LEVEL) {
        left = x
        break
      }
    }
    for (let x = width - 1; x >= 0; x--) {
      const i = rowStart + x * 4
      if (luminance(out[i], out[i + 1], out[i + 2]) > BLACK_LEVEL) {
        right = x
        break
      }
    }
    if (left < 0) {
      // 整行都是黑色（理论上不会发生），整行透明
      for (let x = 0; x < width; x++) out[rowStart + x * 4 + 3] = 0
      continue
    }

    // 2. 边界之外 = 透明
    for (let x = 0; x < left; x++) out[rowStart + x * 4 + 3] = 0
    for (let x = right + 1; x < width; x++) out[rowStart + x * 4 + 3] = 0

    // 3. 过渡带：用亮度还原 alpha（压平公式 pixel = alpha × FG，FG 明亮）
    const applyRamp = (from, step) => {
      for (let k = 0; k < RAMP_PIXELS; k++) {
        const x = from + step * k
        if (x < left || x > right) break
        const i = rowStart + x * 4
        const lum = luminance(out[i], out[i + 1], out[i + 2])
        out[i + 3] = Math.max(0, Math.min(255, Math.round(lum)))
      }
    }
    // 两侧过渡带不重叠时才逐像素还原，否则重叠区取较实的一侧
    if (right - left >= RAMP_PIXELS * 2) {
      applyRamp(left, 1)
      applyRamp(right, -1)
    } else {
      applyRamp(left, 1)
    }
  }
  return out
}

async function fixOne(relativePath) {
  const absolute = join(root, relativePath)
  let sharp
  try {
    sharp = (await import('sharp')).default
  } catch {
    console.error('请先安装: npm i -D sharp')
    process.exit(1)
  }

  const input = await readFile(absolute)
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const fixed = restoreAlpha(data, info.width, info.height)
  await writeFile(absolute, await sharp(fixed, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer())

  // 复核：四角必须完全透明，内部必须不透明
  const check = await sharp(absolute).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = (x, y) => {
    const i = (y * info.width + x) * 4
    return check.data[i + 3]
  }
  console.log(
    `${relativePath}  ${info.width}x${info.height}  alpha: 角(0,0)=${at(0, 0)} 中心=${at(
      Math.floor(info.width / 2),
      Math.floor(info.height / 2),
    )} 边中=${at(Math.floor(info.width / 2), 0)}`,
  )
}

const targets = process.argv.slice(2)
const files = targets.length
  ? targets
  : ['resources/pi-mx-icon.png', 'src/renderer/src/assets/pi-mx-icon.png']

for (const file of files) {
  await fixOne(file)
}
