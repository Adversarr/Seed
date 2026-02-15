/**
 * Root layout — shared app shell using the shadcn sidebar-10 pattern.
 */

import { useEffect } from "react"
import type { CSSProperties } from "react"
import { Outlet } from "react-router-dom"

import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts"
import {
  registerConversationSubscriptions,
  registerTaskStoreSubscriptions,
  unregisterConversationSubscriptions,
  unregisterTaskStoreSubscriptions,
} from "@/stores"

export function RootLayout() {
  // Global keyboard shortcuts (Ctrl+N, Escape, g-h / g-a / g-s).
  useKeyboardShortcuts()

  // Cleanup store subscriptions on unmount (prevents leaked listeners on HMR).
  useEffect(() => {
    // Re-register on mount so StrictMode/HMR unmount-remount cycles keep stores live.
    registerTaskStoreSubscriptions()
    registerConversationSubscriptions()

    return () => {
      unregisterTaskStoreSubscriptions()
      unregisterConversationSubscriptions()
    }
  }, [])

  return (
    <SidebarProvider
      defaultOpen
      style={
        {
          // Keep a stable desktop width so content cannot "stretch" the sidebar.
          "--sidebar-width": "15rem",
          "--sidebar-width-icon": "3rem",
        } as CSSProperties
      }
    >
      <AppSidebar collapsible="icon" variant="sidebar" />

      <SidebarInset>
        <div className="flex h-svh min-w-0 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            <SidebarTrigger className="-ml-1" />
          </header>
          <main className="flex-1 min-w-0 overflow-hidden">
            <div className="mx-auto h-full min-w-0 max-w-4xl px-6 py-6">
              <Outlet />
            </div>
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
