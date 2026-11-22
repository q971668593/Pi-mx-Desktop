#!/usr/bin/env node
// Re-shoot every README visual from the real app:  npm run readme:capture [-- options]
//
//   --lang zh,en      languages to capture (default: zh,en)
//   --only a,b        subset of the steps below (default: all)
//   --work <dir>      scratch directory (default: <os tmp>/pi-readme-capture)
//   --skip-build      reuse <work>/app/out from a previous run
//   --keep-work       keep the scratch directory afterwards
//
// Steps and outputs (doc/assets/readme/<lang>/ unless noted):
//   screens   hero-{light,dark}.png + the raw stills the other steps crop from
//   timeline  timeline.gif             expanded tool steps folding back into one line
//   agent     agent-turn.gif           real worker turn against the scripted endpoint
//   composer  composer-mention.gif     typing @ pops file candidates
//   review    review-stage.gif         widen panel, side-by-side diff, stage a hunk
//   files     files-preview.gif        tree, preview, quote a line
//   terminal  terminal.gif             drawer, two commands, a split
//   branches  branches.gif             status bar branch picker → switch
//   team      team-dispatch.gif        open a card, dispatch it
//   usage     usage.png                Settings → Usage, 90 days
//   themes    themes.png               Claude preset light | dark with a background image
//   visuals   overview.png, architecture-{light,dark}.png, theme-switch.gif (frontend-rendered;
//             needs the screens and the frames of files/terminal/composer)
//   social    doc/assets/readme/social-preview.png
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { prepareApp } from './app.mjs'
import { captureAppearance, captureScreens } from './capture.mjs'
import { ASSET_DIR, CROPS, LANGS, MOCK_PORT, REPO, VIEWPORT } from './config.mjs'
import { checkTools, framedHero, framesToGif, sideBySide, socialCard, tile } from './media.mjs'
import {
  recordAgentTurn, recordComposer, recordFiles, recordReviewStage, recordTeamDispatch, recordTimeline,
} from './record.mjs'
import { captureThemes, captureUsage, recordBranches, recordTerminal } from './record-features.mjs'
import { renderPages } from './render.mjs'
import { seedDemo } from './seed.mjs'
import { visualJobs } from './visuals.mjs'

const STEPS = [
  'screens', 'timeline', 'agent', 'composer', 'review', 'files', 'terminal', 'branches', 'team',
  'usage', 'themes', 'visuals', 'social',
]
const { values } = parseArgs({
  options: {
    lang: { type: 'string', default: LANGS.join(',') },
    only: { type: 'string', default: STEPS.join(',') },
    work: { type: 'string', default: join(tmpdir(), 'pi-readme-capture') },
    'skip-build': { type: 'boolean', default: false },
    'keep-work': { type: 'boolean', default: false },
  },
})
const langs = values.lang.split(',').filter((lang) => LANGS.includes(lang))
const only = new Set(values.only.split(','))
const work = resolve(values.work)
const rawDir = join(work, 'raw')
const tmp = join(work, 'tmp')
const gifDir = join(work, 'gif')

/** Downscale a rendered PNG for the README and store it as 8-bit. */
const optimize = (file, width) => execFileSync('magick', [file, '-resize', `${width}x>`, '-strip', '-depth', '8', '-define', 'png:compression-level=9', file])

/** Copy the last frame of a recording into raw/ so `visuals` can crop it. */
function promoteLastFrame(framesDir, out) {
  const frames = readdirSync(framesDir).filter((name) => /^f\d+\.png$/.test(name)).sort()
  if (!frames.length) throw new Error(`readme-capture: no frames in ${framesDir}`)
  execFileSync('magick', [join(framesDir, frames.at(-1)), out])
}

const RECORDING_STEPS = new Set(['timeline', 'agent', 'composer', 'review', 'files', 'terminal', 'branches', 'team', 'visuals'])
checkTools([...only].some((step) => RECORDING_STEPS.has(step)))
mkdirSync(rawDir, { recursive: true })
mkdirSync(tmp, { recursive: true })
mkdirSync(gifDir, { recursive: true })

console.log('• building capture app')
const appDir = prepareApp(work, { skipBuild: values['skip-build'] })

for (const lang of langs) {
  const out = join(ASSET_DIR, lang)
  mkdirSync(out, { recursive: true })
  const staticDemo = () => seedDemo({ root: join(work, `demo-${lang}`), lang, mockPort: MOCK_PORT })
  const liveDemo = (name) => seedDemo({ root: join(work, `${name}-${lang}`), lang, live: true, mockPort: MOCK_PORT })
  const frames = (name) => join(work, `frames-${name}-${lang}`)
  /** Render frames to a GIF in the scratch dir, then copy it into the README assets. */
  const renderGif = ({ name, file, width, crop }) => {
    framesToGif({ framesDir: frames(name), out: join(gifDir, `${lang}-${name}.gif`), width, crop })
    copyFileSync(join(gifDir, `${lang}-${name}.gif`), join(out, file))
  }

  if (only.has('screens')) {
    console.log(`• ${lang}: screenshots`)
    const demo = await staticDemo()
    for (const theme of ['light', 'dark']) await captureScreens({ appDir, demo, lang, theme, rawDir })
    framedHero({ input: join(rawDir, `${lang}-light-hero.png`), out: join(out, 'hero-light.png'), theme: 'light', tmp })
    framedHero({ input: join(rawDir, `${lang}-dark-hero.png`), out: join(out, 'hero-dark.png'), theme: 'dark', tmp })
  }

  if (only.has('timeline')) {
    console.log(`• ${lang}: timeline`)
    await recordTimeline({ appDir, demo: await staticDemo(), lang, outDir: frames('timeline') })
    renderGif({ name: 'timeline', file: 'timeline.gif', width: 1280, crop: { x: 0, y: 36, width: VIEWPORT.width, height: 828 } })
  }

  if (only.has('agent')) {
    console.log(`• ${lang}: live agent turn`)
    await recordAgentTurn({ appDir, demo: await liveDemo('live'), lang, outDir: frames('agent') })
    renderGif({ name: 'agent', file: 'agent-turn.gif', width: 1100, crop: { x: 0, y: 36, width: VIEWPORT.width, height: 828 } })
  }

  if (only.has('composer')) {
    console.log(`• ${lang}: composer`)
    await recordComposer({ appDir, demo: await staticDemo(), lang, outDir: frames('composer') })
    renderGif({ name: 'composer', file: 'composer-mention.gif', width: 800, crop: { x: 360, y: 372, width: 620, height: 500 } })
    promoteLastFrame(frames('composer'), join(rawDir, `${lang}-composer.png`))
  }

  if (only.has('review')) {
    console.log(`• ${lang}: review staging`)
    await recordReviewStage({ appDir, demo: await staticDemo(), lang, outDir: frames('review') })
    renderGif({ name: 'review', file: 'review-stage.gif', width: 1280, crop: { x: 0, y: 36, width: VIEWPORT.width, height: 828 } })
  }

  if (only.has('files')) {
    console.log(`• ${lang}: files panel`)
    await recordFiles({ appDir, demo: await staticDemo(), lang, outDir: frames('files') })
    renderGif({ name: 'files', file: 'files-preview.gif', width: 1280, crop: { x: 0, y: 36, width: VIEWPORT.width, height: 828 } })
    promoteLastFrame(frames('files'), join(rawDir, `${lang}-panel-files.png`))
  }

  if (only.has('terminal')) {
    console.log(`• ${lang}: terminal`)
    await recordTerminal({ appDir, demo: await staticDemo(), lang, outDir: frames('terminal') })
    renderGif({ name: 'terminal', file: 'terminal.gif', width: 1000, crop: { x: 980, y: 78, width: 460, height: 700 } })
    promoteLastFrame(frames('terminal'), join(rawDir, `${lang}-panel-terminal.png`))
  }

  if (only.has('branches')) {
    console.log(`• ${lang}: branches`)
    await recordBranches({ appDir, demo: await staticDemo(), lang, outDir: frames('branches') })
    renderGif({ name: 'branches', file: 'branches.gif', width: 1100, crop: { x: 0, y: 36, width: VIEWPORT.width, height: 864 } })
  }

  if (only.has('team')) {
    console.log(`• ${lang}: team dispatch`)
    await recordTeamDispatch({ appDir, demo: await staticDemo(), lang, outDir: frames('team') })
    renderGif({ name: 'team', file: 'team-dispatch.gif', width: 1100, crop: { x: 460, y: 36, width: 980, height: 828 } })
  }

  if (only.has('usage')) {
    console.log(`• ${lang}: usage`)
    const raw = join(rawDir, `${lang}-usage.png`)
    await captureUsage({ appDir, demo: await staticDemo(), lang, out: raw })
    tile({ input: raw, out: join(out, 'usage.png'), crop: CROPS.usage, tmp })
  }

  if (only.has('themes')) {
    console.log(`• ${lang}: themes`)
    const image = join(tmp, 'wallpaper.jpg')
    if (!existsSync(image)) copyFileSync(join(REPO, 'scripts/readme-capture/assets/wallpaper.jpg'), image)
    await captureAppearance({ appDir, demo: await staticDemo(), lang, rawDir, image })
    sideBySide({ inputs: [join(rawDir, `${lang}-theme-light.png`), join(rawDir, `${lang}-theme-dark-bg.png`)], out: join(out, 'themes.png'), tmp })
  }

  if (only.has('visuals')) {
    console.log(`• ${lang}: rendered visuals`)
    for (const need of [`${lang}-panel-terminal.png`, `${lang}-panel-files.png`, `${lang}-composer.png`]) {
      if (!existsSync(join(rawDir, need))) throw new Error(`readme-capture: visuals need ${need}; run the files/terminal/composer steps too`)
    }
    renderPages(visualJobs({ lang, rawDir, tmp, outDir: out }), tmp)
    for (const name of ['overview.png', 'architecture-light.png', 'architecture-dark.png']) optimize(join(out, name), 1800)
    framesToGif({ framesDir: join(tmp, `frames-theme-${lang}`), out: join(gifDir, `${lang}-theme-switch.gif`), width: 1000 })
    copyFileSync(join(gifDir, `${lang}-theme-switch.gif`), join(out, 'theme-switch.gif'))
  }
}

if (only.has('social')) {
  console.log('• social preview')
  const hero = join(rawDir, 'en-light-hero.png')
  if (!existsSync(hero)) {
    const demo = await seedDemo({ root: join(work, 'demo-en'), lang: 'en', mockPort: MOCK_PORT })
    await captureScreens({ appDir, demo, lang: 'en', theme: 'light', rawDir })
  }
  socialCard({ heroPng: hero, out: join(ASSET_DIR, 'social-preview.png'), tmp })
}

if (!values['keep-work']) rmSync(work, { recursive: true, force: true })
console.log('done')
