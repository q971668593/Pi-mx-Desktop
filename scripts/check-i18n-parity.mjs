#!/usr/bin/env node
/**
 * i18n parity gate: every locale namespace must define the same keys.
 *
 * A missing English key is invisible in tests (i18next renders the raw key) but shows up as
 * `settings:usage.callsCount` in the UI for English users. Plural suffixes are normalized
 * (`_one` / `_other` … come from Intl.PluralRules; zh has a single form), so a pluralized
 * English entry is not reported as missing just because Chinese has one form.
 *
 *   node scripts/check-i18n-parity.mjs   # exits 1 and lists every gap
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const LOCALES = ['en', 'zh']
const ROOT = 'src/renderer/src/locales'

function flatten(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return prefix ? [prefix] : []
  return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
}

const stripPlural = (key) => key.replace(/_(zero|one|two|few|many|other)$/u, '')

/** { namespace, missingIn: locale, keys } for every asymmetry between the locales. */
export function compareLocales(root = ROOT) {
  const namespaces = [...new Set(LOCALES.flatMap((locale) =>
    readdirSync(join(root, locale)).filter((name) => name.endsWith('.json')).map((name) => name),
  ))].sort()
  const gaps = []
  for (const namespace of namespaces) {
    const keys = Object.fromEntries(LOCALES.map((locale) => {
      try {
        const parsed = JSON.parse(readFileSync(join(root, locale, namespace), 'utf8'))
        return [locale, new Set(flatten(parsed).map(stripPlural))]
      } catch {
        return [locale, new Set()]
      }
    }))
    for (const locale of LOCALES) {
      const others = LOCALES.filter((item) => item !== locale)
      const missing = [...keys[locale]].filter((key) => others.some((other) => !keys[other].has(key)))
      if (missing.length) gaps.push({ namespace, locale, missing: missing.sort() })
    }
  }
  return gaps
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const gaps = compareLocales()
  if (!gaps.length) {
    console.log('[i18n] locales are in parity')
  } else {
    for (const gap of gaps) console.error(`[i18n] ${gap.locale}/${gap.namespace}: ${gap.missing.join(', ')}`)
    console.error(`[i18n] ${gaps.length} namespace(s) out of parity`)
    process.exit(1)
  }
}
