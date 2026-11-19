import { describe, expect, it } from 'vitest'
import { hasKnownFileExtension, normalizePathCandidate, singleFilePath, splitPaths } from './file-path-text'

describe('singleFilePath', () => {
  it.each([
    'D:\\workspace\\2026 - 高新国资上报\\V1\\.docs\\对接\\14.BIP报表导出件交付清单（发包商-2026-11-19）.xlsx',
    'D:/workspace/V1/.docs/14.BIP报表.xlsx',
    '\\\\wsl.localhost\\Ubuntu\\home\\u\\out\\report.pdf',
    '/home/user/project/output/report.pdf',
    './tools/make_bip_report_export_checklist.py',
    'src/renderer/src/app/app.tsx',
    '14.BIP报表导出件交付清单（发包商-2026-11-19）.docx',
    '`D:\\workspace\\V1\\out\\report.md`',
    '“D:\\workspace\\V1\\out\\report.md”',
    'src/app.ts:12:3',
  ])('accepts a whole-string file reference: %s', (value) => {
    expect(singleFilePath(value)).toBeTruthy()
  })

  it.each([
    '完成',
    'v1.0.3',
    'https://example.com/report.pdf',
    'npm run dev',
    'first.second',
    'report.docx and notes.md',
    'D:\\workspace\\V1\\out\\',
    '',
  ])('rejects prose and non-file strings: %s', (value) => {
    expect(singleFilePath(value)).toBeNull()
  })

  it('keeps an encoded line/column off the path and keeps dots in names', () => {
    expect(normalizePathCandidate('src/app.ts:12:3')).toBe('src/app.ts')
    expect(normalizePathCandidate('.docs/对接/清单（2026）.xlsx。')).toBe('.docs/对接/清单（2026）.xlsx')
    expect(singleFilePath('D:\\a.b\\c.d\\report.v2.xlsx')).toBe('D:\\a.b\\c.d\\report.v2.xlsx')
  })

  it('recognizes document extensions case-insensitively', () => {
    expect(hasKnownFileExtension('A.XLSX')).toBe(true)
    expect(hasKnownFileExtension('README')).toBe(false)
  })
})

describe('splitPaths', () => {
  it('links absolute and relative paths inside running text', () => {
    const segments = splitPaths('生成脚本在 D:\\workspace\\V1\\tools\\make.py，输出到 .docs/out/report.xlsx。')
    expect(segments.filter((s) => s.kind === 'path').map((s) => s.kind === 'path' && s.path)).toEqual([
      'D:\\workspace\\V1\\tools\\make.py',
      '.docs/out/report.xlsx',
    ])
  })

  it('keeps the surrounding text intact', () => {
    expect(splitPaths('见 src/app.ts 的实现')).toEqual([
      { kind: 'text', text: '见 ' },
      { kind: 'path', path: 'src/app.ts' },
      { kind: 'text', text: ' 的实现' },
    ])
  })

  it('does not link URLs or prose words', () => {
    expect(splitPaths('https://example.com/a.pdf')).toEqual([{ kind: 'text', text: 'https://example.com/a.pdf' }])
    expect(splitPaths('完成 first.second')).toEqual([{ kind: 'text', text: '完成 first.second' }])
  })

  it('leaves module aliases alone', () => {
    expect(splitPaths('import x from @renderer/features/app.ts')).toEqual([
      { kind: 'text', text: 'import x from @renderer/features/app.ts' },
    ])
  })
})
