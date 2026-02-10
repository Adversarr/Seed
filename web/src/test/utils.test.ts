/**
 * Tests for the utils module.
 */

import { describe, it, expect } from 'vitest'
import { cn, formatTime, timeAgo, truncate } from '@/lib/utils'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('deduplicates conflicting Tailwind classes', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2')
  })

  it('handles conditionals', () => {
    expect(cn('base', false && 'hidden', 'end')).toBe('base end')
  })
})

describe('formatTime', () => {
  it('returns a time string', () => {
    const result = formatTime('2024-01-15T10:30:00Z')
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/)
  })
})

describe('timeAgo', () => {
  it('returns seconds for recent times', () => {
    const recent = new Date(Date.now() - 5000).toISOString()
    expect(timeAgo(recent)).toMatch(/^\d+s ago$/)
  })

  it('returns minutes for older times', () => {
    const older = new Date(Date.now() - 120_000).toISOString()
    expect(timeAgo(older)).toMatch(/^\d+m ago$/)
  })
})

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('truncates long strings with ellipsis', () => {
    const result = truncate('a'.repeat(100), 10)
    expect(result).toHaveLength(10)
    expect(result.endsWith('…')).toBe(true)
  })
})
