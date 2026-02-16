import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { CreateTaskGroupTaskInput, TaskPriority } from '@/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AgentSelector } from '@/components/navigation/AgentSelector'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type DraftRow = {
  id: string
  agentId?: string
  title: string
  intent: string
  priority: TaskPriority
}

interface CreateTaskGroupDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (tasks: CreateTaskGroupTaskInput[]) => Promise<void>
}

function makeDraftRow(seed = 0): DraftRow {
  return {
    id: `row_${Date.now()}_${seed}`,
    agentId: undefined,
    title: '',
    intent: '',
    priority: 'normal'
  }
}

/**
 * CreateTaskGroupDialog collects multiple child-task specs and submits
 * them in one non-blocking API call.
 */
export function CreateTaskGroupDialog({ open, onClose, onCreate }: CreateTaskGroupDialogProps) {
  const [rows, setRows] = useState<DraftRow[]>([makeDraftRow(0)])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    // Reset dialog state for a predictable create flow on each open.
    setRows([makeDraftRow(0)])
    setSubmitting(false)
    setError(null)
  }, [open])

  const canSubmit = useMemo(() => {
    if (rows.length === 0 || submitting) return false
    return rows.every((row) => Boolean(row.agentId?.trim()) && Boolean(row.title.trim()))
  }, [rows, submitting])

  const updateRow = (rowId: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)))
  }

  const addRow = () => {
    setRows((prev) => [...prev, makeDraftRow(prev.length + 1)])
  }

  const removeRow = (rowId: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.id !== rowId)))
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return

    const payload: CreateTaskGroupTaskInput[] = rows.map((row) => ({
      agentId: row.agentId!.trim(),
      title: row.title.trim(),
      intent: row.intent.trim() || undefined,
      priority: row.priority
    }))

    setSubmitting(true)
    setError(null)
    try {
      await onCreate(payload)
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create Group Members</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-3 max-h-[60vh] overflow-auto pr-1">
            {rows.map((row, index) => (
              <div key={row.id} className="rounded-lg border border-border p-3 space-y-3 bg-zinc-950/20">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-zinc-500">Member {index + 1}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRow(row.id)}
                    disabled={rows.length <= 1 || submitting}
                    aria-label={`Remove member ${index + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="grid gap-2">
                  <Label>Agent</Label>
                  <AgentSelector
                    value={row.agentId}
                    onChange={(agentId) => updateRow(row.id, { agentId })}
                    className="w-full"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor={`${row.id}-title`}>Title</Label>
                  <Input
                    id={`${row.id}-title`}
                    value={row.title}
                    onChange={(e) => updateRow(row.id, { title: e.target.value })}
                    placeholder="Task title"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor={`${row.id}-intent`}>Intent (optional)</Label>
                  <Textarea
                    id={`${row.id}-intent`}
                    value={row.intent}
                    onChange={(e) => updateRow(row.id, { intent: e.target.value })}
                    rows={2}
                    placeholder="Additional context for this member"
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Priority</Label>
                  <Select
                    value={row.priority}
                    onValueChange={(value) => updateRow(row.id, { priority: value as TaskPriority })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="foreground">foreground</SelectItem>
                      <SelectItem value="normal">normal</SelectItem>
                      <SelectItem value="background">background</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>

          <Button type="button" variant="secondary" onClick={addRow} disabled={submitting}>
            <Plus className="h-3.5 w-3.5" />
            Add Member
          </Button>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? 'Creating…' : 'Create Group'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
