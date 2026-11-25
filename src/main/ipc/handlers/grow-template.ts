/**
 * 方案.html 的样式模板：startSession 时原样写入会话目录 `_模板.html`。
 * 智能体照着它的结构和样式填真实内容，不自创样式。
 * 风格：干净浅色、绿色主色、圆角卡片，和咱们自己的面板语言一致。
 */
export const GROW_DOC_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<!-- 智能体：把 <title> 和 header 里 {{}} 换成真实内容；删掉本注释 -->
<title>{{需求一句话}} · 需求方案</title>
<style>
  :root {
    --green: #15803d; --green-soft: #f0fdf4; --ink: #1a2b22; --muted: #64748b;
    --line: #e2e8f0; --amber: #b45309; --amber-soft: #fffbeb; --card: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #e2e8f0; --muted: #94a3b8; --line: #334155; --green-soft: #052e16; --amber-soft: #451a03; --card: #0f172a; }
    body { background: #020617; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f8fafc; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.75; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 32px 20px 64px; }
  header.hero { background: var(--green-soft); border: 1px solid var(--line); border-radius: 16px; padding: 24px 28px; }
  header.hero h1 { margin: 0 0 8px; font-size: 24px; }
  header.hero .meta { color: var(--muted); font-size: 13px; }
  nav.toc { margin: 20px 0; padding: 12px 16px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; font-size: 14px; }
  nav.toc a { color: var(--green); text-decoration: none; margin-right: 16px; }
  section.chapter { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px 24px; margin: 16px 0; }
  section.chapter h2 { margin: 0 0 8px; font-size: 18px; }
  section.chapter h2 .no { display: inline-block; min-width: 28px; height: 28px; line-height: 28px; text-align: center;
    background: var(--green); color: #fff; border-radius: 8px; font-size: 14px; margin-right: 8px; }
  .badge { display: inline-block; font-size: 12px; border-radius: 999px; padding: 1px 10px; margin-left: 8px; vertical-align: middle; }
  .badge.ok { background: var(--green-soft); color: var(--green); border: 1px solid var(--green); }
  .badge.todo { background: var(--amber-soft); color: var(--amber); border: 1px solid var(--amber); }
  .accept { margin: 12px 0 0; padding: 0; list-style: none; font-size: 14px; }
  .accept li::before { content: "✓"; color: var(--green); margin-right: 8px; font-weight: bold; }
  .accept li.open::before { content: "○"; color: var(--amber); }
  .pending { background: var(--amber-soft); border: 1px dashed var(--amber); border-radius: 8px; padding: 10px 14px; font-size: 14px; margin-top: 12px; }
  footer { margin-top: 32px; color: var(--muted); font-size: 12px; text-align: center; }
  @media print { nav.toc { display: none; } section.chapter { break-inside: avoid; } }
</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <h1>{{需求一句话}}</h1>
    <div class="meta">会话 {{session_id}} · 共 {{N}} 轮澄清 · 修订 {{revision}} · {{日期}}</div>
  </header>
  <nav class="toc">
    <!-- 智能体：一章一个链接 -->
    <a href="#F-01">F-01 {{第一章标题}}</a>
  </nav>
  <!-- 智能体：照着下面复制章节，id 递增；已确认的 acceptance 列清单，未定的进 .pending 格子 -->
  <section class="chapter" id="F-01">
    <h2><span class="no">1</span>{{第一章标题}}<span class="badge ok">已确认</span></h2>
    <p>{{这一章要做什么、为什么，3-5 句人话}}</p>
    <ul class="accept">
      <li>{{验收标准一}}</li>
      <li class="open">{{还没定的验收，标 open}}</li>
    </ul>
    <div class="pending">待定：{{拿不准的点，写清楚缺什么信息}}</div>
  </section>
  <footer>由需求树访谈生成 · 数据在 .文档/grow-me/{{session_id}}/ · 一键转看板见右侧面板</footer>
</div>
</body>
</html>
`
