/**
 * 项目 MRU 列表的纯逻辑放在 @shared，主进程和渲染进程共用同一个上限，
 * 避免两边各写一个数字（10 vs 16）互相截断。
 */
export { RECENT_PROJECTS_CAP, capRecentProjects, nextRecentProjects } from '@shared/recent-projects'
