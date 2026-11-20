import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const src = 'build/icon.png'
const res = 'apps/mobile/androidApp/src/main/res'
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }

for (const [name, scale] of Object.entries(densities)) {
  const dir = `${res}/mipmap-${name}`
  mkdirSync(dir, { recursive: true })
  const legacy = Math.round(48 * scale)
  const adaptive = Math.round(108 * scale)
  const inset = Math.round(adaptive * 0.16) // 66% safe zone → logo ~68%
  const logo = adaptive - inset * 2
  await sharp(src).resize(legacy, legacy, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(`${dir}/ic_launcher.png`)
  await sharp(src).resize(logo, logo, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: inset, bottom: inset, left: inset, right: inset, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toFile(`${dir}/ic_launcher_foreground.png`)
}
// round icon (Android 7.1 launchers)
mkdirSync(`${res}/mipmap-anydpi`, { recursive: true })
console.log('done')
