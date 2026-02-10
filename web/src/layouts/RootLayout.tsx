/**
 * Root layout — sidebar + main content area.
 */

import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Sparkles, LayoutDashboard, Settings, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConnectionIndicator } from '@/components/ConnectionIndicator'
import { useTaskStore } from '@/stores'

function SidebarLink({ to, icon: Icon, label }: { to: string; icon: typeof LayoutDashboard; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
          isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50',
        )
      }
    >
      <Icon size={18} />
      {label}
    </NavLink>
  )
}

export function RootLayout() {
  const navigate = useNavigate()
  const activeTasks = useTaskStore(s => s.tasks.filter(t => !['done', 'failed', 'canceled'].includes(t.status)).length)

  return (
    <div className="flex h-screen bg-zinc-950">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-zinc-800 flex flex-col">
        {/* Logo */}
        <div
          className="flex items-center gap-2 px-4 py-4 cursor-pointer"
          onClick={() => navigate('/')}
        >
          <Sparkles size={20} className="text-violet-400" />
          <span className="text-sm font-bold tracking-tight text-zinc-100">CoAuthor</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-1">
          <SidebarLink to="/" icon={LayoutDashboard} label={`Tasks${activeTasks > 0 ? ` (${activeTasks})` : ''}`} />
          <SidebarLink to="/activity" icon={Activity} label="Activity" />
          <SidebarLink to="/settings" icon={Settings} label="Settings" />
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-zinc-800 space-y-2">
          <ConnectionIndicator />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
