// 给演示项目写入一份真实的 `.文档/开发规范` 骨架 + 工作团队看板，
// 让 README 里的「工作团队」面板截到真有卡片的样子，而不是空态。
// 格式与 packages/shared/team-board.ts 的解析器完全一致（DSH flow-board 同款 markdown）。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const COPY = {
  zh: {
    spec: '.文档/开发规范',
    batch: 'v0.4 远程链接检查',
    goal: '`lumen check --remote` 能跑通：外链 404 被 CI 拦住，退出码可判断',
    headers: ['编号', '标题', '角色', '状态', '一句话'],
    files: {
      'PRD.md': `# PRD：v0.4 远程链接检查

## 背景

\`lumen\` 现在只解析本地链接，外部链接是否 404 需要人工点开确认。

## 目标

- \`lumen check --remote\` 检查外链状态码
- 同一域名最多 4 个并发，结果按 URL 缓存
- 有失败链接时退出码为 1，方便 CI 门禁

## 非目标

- 不改 \`parseLinks()\` 的返回结构
`,
      '错题本.md': `# 错题本

- 用「应该可以」代替实跑输出，被 CI 打回。改为必须先贴 \`node --test\` 输出。
`,
      '品味账本.md': `# 品味账本

- CLI 输出保持一列对齐，宽度不随域名长度抖动。
`,
    },
    roles: {
      Leader: 'anthropic/claude-opus-4-5',
      设计师: 'anthropic/claude-sonnet-4-5',
      前端: 'anthropic/claude-sonnet-4-5',
      后端: 'anthropic/claude-sonnet-4-5',
      质量测试: 'anthropic/claude-haiku-4-5',
    },
    notes: {
      Leader: '拆 PRD、定验收口径、卡住时拍板',
      设计师: 'CLI 输出与文档站视觉一致',
      前端: '进度输出与文档站页面',
      后端: '抓取层、并发与缓存',
      质量测试: '单测、边界用例、回归',
    },
    cards: [
      {
        id: 'T-001',
        title: '拆 PRD 与验收口径',
        role: 'Leader',
        status: '已验收',
        wave: '第一波',
        summary: '把 v0.4 拆成三波任务，写清退出码约定',
        input: 'PRD.md',
        output: '看板 + 验收清单',
        acceptance: [
          ['三条主链路各有一张卡', true],
          ['退出码约定写进 PRD', true],
        ],
      },
      {
        id: 'T-002',
        title: 'fetchStatus 抓取层',
        role: '后端',
        status: '实现完成',
        wave: '第二波',
        summary: 'HEAD 优先，失败回退 GET，5 秒超时',
        input: 'PRD.md',
        output: 'src/remote.mjs',
        acceptance: [
          ['HEAD 405 时回退 GET', true],
          ['超时 5 秒返回 unknown', true],
        ],
      },
      {
        id: 'T-003',
        title: '同域并发与结果缓存',
        role: '后端',
        status: '待审查',
        wave: '第二波',
        summary: '同域最多 4 并发，URL 级缓存避免重复请求',
        input: 'T-002 产出',
        output: 'src/remote.mjs',
        dependsOn: 'T-002',
        acceptance: [
          ['同域并发不超过 4', true],
          ['重复 URL 只请求一次', false],
        ],
      },
      {
        id: 'T-004',
        title: '远程检查进度输出',
        role: '前端',
        status: '进行中',
        wave: '第三波',
        summary: '逐条打印 `url → status`，失败行标红',
        input: 'src/remote.mjs',
        output: 'src/cli.mjs',
        acceptance: [['宽度对齐不随域名抖动', false]],
      },
      {
        id: 'T-005',
        title: '抓取层边界用例',
        role: '质量测试',
        status: '待办',
        wave: '第三波',
        summary: '重定向、超时、非 2xx/3xx、IPv6 域名',
        dependsOn: 'T-002、T-003',
        acceptance: [['四类边界都有用例', false]],
      },
      {
        id: 'T-006',
        title: 'CI 门禁接入',
        role: '后端',
        status: '阻塞',
        blockType: '待用户确认',
        wave: '第四波',
        summary: '是否允许 CI 访问外网需要主人拍板',
        approval: '是否把远程检查放进 CI（需要出网权限）',
        acceptance: [['CI 里能拿到退出码 1', false]],
      },
      {
        id: 'T-007',
        title: '文档站更新',
        role: '设计师',
        status: '待办',
        wave: '第四波',
        summary: '补 `--remote` 用法与退出码表',
        acceptance: [['用法段有示例输出', false]],
      },
      {
        id: 'T-008',
        title: 'CLI 参数与退出码',
        role: '后端',
        status: '进行中',
        wave: '第三波',
        summary: '解析 `--remote`，失败链接让退出码为 1',
        acceptance: [
          ['`--json` 与 `--remote` 可组合', false],
          ['失败时退出码 1', false],
        ],
      },
    ],
  },
  en: {
    spec: '.文档/开发规范',
    batch: 'v0.4 remote link checks',
    goal: '`lumen check --remote` ships: failing external links gate CI',
    headers: ['ID', 'Title', 'Role', 'Status', 'Summary'],
    files: {
      'PRD.md': `# PRD: v0.4 remote link checks

## Why

\`lumen\` only parses local links today; external 404s need a manual click.

## Scope

- \`lumen check --remote\` checks status codes
- at most 4 requests per host, results cached by URL
- exit code 1 when a link fails, so CI can gate on it
`,
      '错题本.md': `# Lessons

- Shipped "should work" instead of real output; CI bounced it. Always paste \`node --test\` output.
`,
      '品味账本.md': `# Taste

- Keep CLI columns aligned; width must not jitter with domain length.
`,
    },
    roles: {
      Leader: 'anthropic/claude-opus-4-5',
      设计师: 'anthropic/claude-sonnet-4-5',
      前端: 'anthropic/claude-sonnet-4-5',
      后端: 'anthropic/claude-sonnet-4-5',
      质量测试: 'anthropic/claude-haiku-4-5',
    },
    notes: {
      Leader: 'Splits the PRD, owns acceptance',
      设计师: 'CLI output and docs site',
      前端: 'Progress output and docs pages',
      后端: 'Fetch layer, concurrency, cache',
      质量测试: 'Unit tests and edge cases',
    },
    cards: [
      {
        id: 'T-001',
        title: 'Split the PRD',
        role: 'Leader',
        status: '已验收',
        wave: 'Wave 1',
        summary: 'Three waves with an exit-code contract',
        acceptance: [
          ['One card per main path', true],
          ['Exit-code contract in the PRD', true],
        ],
      },
      {
        id: 'T-002',
        title: 'fetchStatus fetch layer',
        role: '后端',
        status: '实现完成',
        wave: 'Wave 2',
        summary: 'HEAD first, GET fallback, 5s timeout',
        acceptance: [
          ['Falls back to GET on 405', true],
          ['Times out after 5s', true],
        ],
      },
      {
        id: 'T-003',
        title: 'Per-host concurrency and cache',
        role: '后端',
        status: '待审查',
        wave: 'Wave 2',
        summary: 'At most 4 requests per host, cached by URL',
        dependsOn: 'T-002',
        acceptance: [
          ['Never more than 4 per host', true],
          ['Duplicate URLs fetched once', false],
        ],
      },
      {
        id: 'T-004',
        title: 'Progress output for remote checks',
        role: '前端',
        status: '进行中',
        wave: 'Wave 3',
        summary: 'Print `url → status`, flag failing rows',
        acceptance: [['Columns stay aligned', false]],
      },
      {
        id: 'T-005',
        title: 'Edge cases for the fetch layer',
        role: '质量测试',
        status: '待办',
        wave: 'Wave 3',
        summary: 'Redirects, timeouts, non-2xx, IPv6 hosts',
        dependsOn: 'T-002、T-003',
        acceptance: [['All four cases covered', false]],
      },
      {
        id: 'T-006',
        title: 'Wire it into CI',
        role: '后端',
        status: '阻塞',
        blockType: '待用户确认',
        wave: 'Wave 4',
        summary: 'Needs a decision on outbound network access',
        approval: 'Allow outbound network access from CI?',
        acceptance: [['CI sees exit code 1', false]],
      },
      {
        id: 'T-007',
        title: 'Docs site update',
        role: '设计师',
        status: '待办',
        wave: 'Wave 4',
        summary: 'Document `--remote` and the exit codes',
        acceptance: [['Usage has sample output', false]],
      },
      {
        id: 'T-008',
        title: 'CLI flags and exit codes',
        role: '后端',
        status: '进行中',
        wave: 'Wave 3',
        summary: 'Parse `--remote`, exit 1 on failures',
        acceptance: [
          ['`--json` combines with `--remote`', false],
          ['Exit 1 on failure', false],
        ],
      },
    ],
  },
}

/** 看板 markdown：索引表 + 卡片详情，字段名与 shared/team-board.ts 一致。 */
function boardMarkdown(c) {
  const index = c.cards.map((card) => `| ${card.id} | ${card.title} | ${card.role} | ${card.status} | ${card.summary} |`)
  const cards = c.cards.map((card) => {
    const lines = [`### ${card.id} ${card.title}`, '', `- 角色：${card.role}`, `- 状态：${card.status}`]
    if (card.wave) lines.push(`- 波次：${card.wave}`)
    if (card.dependsOn) lines.push(`- 依赖：${card.dependsOn}`)
    if (card.blockType) lines.push(`- 阻塞分型：${card.blockType}`)
    if (card.approval) lines.push(`- 待批准：${card.approval}`)
    lines.push('')
    for (const [text, done] of card.acceptance) lines.push(`- [${done ? 'x' : ' '}] ${text}`)
    return lines.join('\n')
  })
  return [
    '# 看板：当前批次',
    '',
    '## 批次信息',
    '',
    `- 当前批次：${c.batch}`,
    `- 目标：${c.goal}`,
    '',
    '## 任务索引',
    '',
    `| ${c.headers.join(' | ')} |`,
    '|------|------|------|------|------|',
    ...index,
    '',
    '## 卡片详情',
    '',
    cards.join('\n\n'),
    '',
  ].join('\n')
}

/**
 * 写入项目级 `.文档/开发规范`：看板、PRD、角色配置（含模型绑定）。
 * @param {string} project 演示项目根目录
 * @param {'zh' | 'en'} lang
 */
export function seedTeamBoard(project, lang) {
  const c = COPY[lang]
  const spec = join(project, c.spec)
  mkdirSync(join(spec, '看板'), { recursive: true })
  mkdirSync(join(spec, '协作'), { recursive: true })
  for (const [name, content] of Object.entries(c.files)) writeFileSync(join(spec, name), content, 'utf8')
  writeFileSync(join(spec, '看板/当前批次.md'), boardMarkdown(c), 'utf8')
  const roles = Object.entries(c.roles).map(([role, model]) => ({
    role,
    model,
    effort: role === 'Leader' ? 'high' : 'medium',
    note: c.notes[role],
    enabled: true,
    directEnabled: true,
  }))
  writeFileSync(join(spec, '角色配置.json'), `${JSON.stringify({ version: 2, scope: 'project', roles }, null, 2)}\n`, 'utf8')
  return spec
}
