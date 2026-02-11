/**
 * App — root router configuration with lazy-loaded pages.
 */

import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { RootLayout } from '@/layouts/RootLayout'
import { PageSkeleton } from '@/components/PageSkeleton'

const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const TaskDetailPage = lazy(() => import('@/pages/TaskDetailPage').then(m => ({ default: m.TaskDetailPage })))
const ActivityPage = lazy(() => import('@/pages/ActivityPage').then(m => ({ default: m.ActivityPage })))
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })))

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<RootLayout />}>
          <Route index element={<Suspense fallback={<PageSkeleton />}><DashboardPage /></Suspense>} />
          <Route path="tasks/:taskId" element={<Suspense fallback={<PageSkeleton />}><TaskDetailPage /></Suspense>} />
          <Route path="activity" element={<Suspense fallback={<PageSkeleton />}><ActivityPage /></Suspense>} />
          <Route path="settings" element={<Suspense fallback={<PageSkeleton />}><SettingsPage /></Suspense>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
