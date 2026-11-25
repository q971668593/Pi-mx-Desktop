/** /澄清 的开场白：把会话 id 和最小协议喂给智能体，用户发送后访谈开始 */

export const GROW_KICKOFF_HEADING = '请用需求树方式帮我澄清需求，我要做的是：'

export function buildGrowKickoff(sessionId: string, requirement: string): string {
  const safeSession = /^[A-Za-z0-9_-]{1,64}$/.test(sessionId) ? sessionId : 'g-invalid'
  // 用户原文里如果有围栏，先断开，避免伪造轮次代码块
  const need = (requirement.trim() || '（我还没说具体需求，先问我到底想做什么）').replace(/```/g, '``\u200b`').slice(0, 4000)
  return [
    GROW_KICKOFF_HEADING,
    need,
    '',
    '流程约定（必须遵守）：',
    `1. 本轮会话 id 是 ${safeSession}，数据文件是 .文档/grow-me/${safeSession}/tree.json（已建好，revision 为 0），你的问题和我的回答都在这里。`,
    '2. 每次只问一轮，每轮 3-5 个问题。调用 grow_tree 工具 action=get_state，传入 sessionId，查看答案和 revision；勿直接修改 tree.json。',
    '3. 使用 grow_tree 工具 action=put_questions 提交本轮问题，传 sessionId、round、上一步的 expectedRevision 和 questions。成功后才发 grow-round 卡片。版本冲突时重新 get_state 并根据最新答案调整。两处的 id、kind 和 options 必须一致；新题使用全树唯一的 id。',
    '   - 只允许选一个时用 kind: single；允许同时选多个时用 kind: multiple。两种都要把 2–8 个具体、互不重复的选项放在 options 字符串数组里。题干明确要选什么，别把候选答案只写在题干里。',
    '   - 需要用户自己描述时用 kind: text，不写 options。tree.json 里的题干和解释用 question、rationale，卡片里用 q、why。',
    '   - 每题写 depends_on 数组：初始主问题用 []，追问填写其直接依据的已有题目 id；多个依据都要写，不要猜测关系。每题写 chapter_id：主问题填写自身 id，追问填写所属主问题 id。保留已有关系和答案。',
    '   - 工具里的题目示例：{"id":"q1","question":"问卷想覆盖哪些人群？","kind":"multiple","options":["应届生","在职人群","自由职业者"],"depends_on":[],"chapter_id":"q1"}。发聊天卡片前核对每道题都写了 kind。',
    '```grow-round',
    `{"session":"${safeSession}","round":1,"questions":[{"id":"q1","q":"问卷想覆盖哪些人群？","kind":"multiple","options":["应届生","在职人群","自由职业者"]},{"id":"q2","q":"结果页要展示几个推荐城市？","kind":"single","options":["一个","三个"]},{"id":"q3","q":"还有什么限制需要提前知道？","kind":"text"}]}`,
    '```',
    '4. 卡片会保存选择和自定义回复。下一轮前用 grow_tree get_state 重新读取；稍后答、没看懂和没有实际答案的题都要按待确认处理。',
    '5. 我选择“开始制定方案”时：调用 grow_tree begin_plan 后调用 get_state 读取最新需求树，并记下 begin_plan 返回的 revision；按此快照生成方案；读取会话目录里的 _模板.html，照着模板生成 方案.html（只填真实内容，删注释和示例），每个章节 section 的 id 与 task.manifest.json 的 chapters 对应项 id 完全一致。chapters 含 id/title/summary/acceptance，并与节点 chapter_id 对齐。完成后调用 grow_tree finish_plan，传 begin_plan 返回的 revision 作为 expectedRevision。若版本冲突，重新读取并更新方案，不得直接修改 tree.json。',
    '6. 代码块之外的正文只写一句人话开场白，不要复述题目。',
    '7. 用户要求修改项目 PRD（.文档/开发规范/PRD.md）或已有需求树答案时：先调用 grow_tree action=get_prd_context（已知绑定树时传 sessionId）拿到 basePrdHash、baseTreeRevision 和树列表；然后只发一个 ```grow-prd-proposal 围栏，JSON 字段为 basePrdHash、treeSessionId、baseTreeRevision、reason、proposedPrd（完整新 PRD）、nodeChanges（[{nodeId, expectedOldAnswer（无旧答案用 null）, newAnswer}]）、newQuestions（新增题目数组，无则 []）。不要自己写 PRD 或 tree.json，用户在卡片里审阅确认后才生效。',
    '',
    '现在开始第一轮。',
  ].join('\n')
}
