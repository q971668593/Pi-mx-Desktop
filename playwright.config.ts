import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // zz-ui-review 是「人工看截图」的全站巡检（跑满 5 分钟、断言很少），不是回归用例：
  // 默认跳过，需要时 UI_REVIEW=1 npx playwright test e2e/zz-ui-review.spec.ts。
  testIgnore: process.env.UI_REVIEW ? [] : ['**/zz-ui-review.spec.ts'],
  timeout: process.env.CI ? 180_000 : 120_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
})