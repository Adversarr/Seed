/**
 * Sidebar layout tests — prevent sidebar width and overflow regressions.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SidebarProvider, Sidebar, SidebarContent, SidebarGroup, SidebarInset } from '@/components/ui/sidebar'

describe('Sidebar layout constraints', () => {
  beforeAll(() => {
    // jsdom does not implement matchMedia by default; sidebar hook depends on it.
    if (!window.matchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
          addListener: () => {},
          removeListener: () => {},
        }),
      })
    }
  })

  it('uses a bounded sidebar width token on the provider wrapper', () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarGroup>Sidebar</SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <SidebarInset>Main</SidebarInset>
      </SidebarProvider>
    )

    const wrapper = container.querySelector('div[style*="--sidebar-width"]')
    expect(wrapper).toBeInTheDocument()
    expect(wrapper).toHaveClass('overflow-hidden')
    expect((wrapper as HTMLElement | null)?.style.getPropertyValue('--sidebar-width')).toBe('16rem')
  })

  it('applies min-width and overflow guards to inset and sidebar content', () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>
            <SidebarGroup>
              this-is-an-intentionally-long-unbroken-token-to-stress-horizontal-overflow
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <SidebarInset>Main</SidebarInset>
      </SidebarProvider>
    )

    const inset = screen.getByRole('main')
    expect(inset).toHaveClass('min-w-0')
    expect(inset).toHaveClass('overflow-x-hidden')

    const sidebarShell = document.querySelector('[data-sidebar="sidebar"]')
    expect(sidebarShell).toHaveClass('overflow-hidden')

    const sidebarContent = document.querySelector('[data-sidebar="content"]')
    expect(sidebarContent).toHaveClass('overflow-x-hidden')
    expect(sidebarContent).toHaveClass('overflow-y-auto')
  })
})
