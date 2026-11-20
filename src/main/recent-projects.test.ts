import { describe, expect, it } from 'vitest'
import { RECENT_PROJECTS_CAP, capRecentProjects, nextRecentProjects } from './recent-projects'

describe('nextRecentProjects', () => {
  describe('MRU mode (default, fixedOrder=false)', () => {
    it('moves an existing project to the front', () => {
      expect(nextRecentProjects(['a', 'b', 'c'], 'b', false)).toEqual(['b', 'a', 'c'])
    })

    it('puts a new project at the front', () => {
      expect(nextRecentProjects(['a', 'b'], 'c', false)).toEqual(['c', 'a', 'b'])
    })

    it('caps at the most recent entries', () => {
      const full = Array.from({ length: RECENT_PROJECTS_CAP }, (_, i) => `p${i}`)
      const next = nextRecentProjects(full, 'new', false)
      expect(next).toHaveLength(RECENT_PROJECTS_CAP)
      expect(next[0]).toBe('new')
      expect(next).not.toContain(`p${RECENT_PROJECTS_CAP - 1}`)
    })

    it('never drops a project just because it was opened again', () => {
      const list = Array.from({ length: 12 }, (_, i) => `p${i}`)
      expect(nextRecentProjects(list, 'p11', false)).toHaveLength(12)
      expect(nextRecentProjects(list, 'p0', true)).toHaveLength(12)
    })

    it('keeps room for far more than a handful of projects', () => {
      expect(RECENT_PROJECTS_CAP).toBeGreaterThanOrEqual(30)
    })
  })

  describe('fixed order (fixedOrder=true)', () => {
    it('keeps existing projects in place', () => {
      expect(nextRecentProjects(['a', 'b', 'c'], 'b', true)).toEqual(['a', 'b', 'c'])
      expect(nextRecentProjects(['a', 'b', 'c'], 'c', true)).toEqual(['a', 'b', 'c'])
    })

    it('appends a new project at the end', () => {
      expect(nextRecentProjects(['a', 'b'], 'c', true)).toEqual(['a', 'b', 'c'])
    })

    it('caps by dropping the oldest (first) entry', () => {
      const full = Array.from({ length: RECENT_PROJECTS_CAP }, (_, i) => `p${i}`)
      const next = nextRecentProjects(full, 'new', true)
      expect(next).toHaveLength(RECENT_PROJECTS_CAP)
      expect(next[next.length - 1]).toBe('new')
      expect(next).not.toContain('p0')
    })

    it('deduplicates Windows paths with different slash styles', () => {
      expect(nextRecentProjects(['E:\\myproject\\pi-app', 'D:\\other'], 'E:/myproject/pi-app', true)).toEqual([
        'E:\\myproject\\pi-app',
        'D:\\other',
      ])
      expect(nextRecentProjects(['D:\\other', 'E:\\myproject\\pi-app'], 'E:/myproject/pi-app', false)).toEqual([
        'E:/myproject/pi-app',
        'D:\\other',
      ])
    })
  })
})

describe('capRecentProjects', () => {
  it('keeps short lists untouched (same reference)', () => {
    const list = ['a', 'b']
    expect(capRecentProjects(list)).toBe(list)
  })

  it('trims only when the list is longer than the cap', () => {
    const list = Array.from({ length: RECENT_PROJECTS_CAP + 3 }, (_, i) => `p${i}`)
    expect(capRecentProjects(list)).toHaveLength(RECENT_PROJECTS_CAP)
  })
})
