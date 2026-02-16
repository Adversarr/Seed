import { CheckCircle2, ListTodo } from 'lucide-react'
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from '@/components/ai-elements/queue'
import type { TaskTodoItem } from '@/types'

type TaskTodoQueueProps = {
  todos?: TaskTodoItem[]
  className?: string
}

export function TaskTodoQueue({ todos, className }: TaskTodoQueueProps) {
  const items = todos ?? []
  const pending = items.filter((todo) => todo.status === 'pending')
  const completed = items.filter((todo) => todo.status === 'completed')

  return (
    <Queue className={className}>
      <div className="px-1 text-xs text-zinc-500">
        Todo Queue
      </div>

      <QueueSection defaultOpen>
        <QueueSectionTrigger>
          <QueueSectionLabel
            count={pending.length}
            icon={<ListTodo className="size-4" />}
            label="Pending"
          />
        </QueueSectionTrigger>
        <QueueSectionContent>
          {pending.length === 0 ? (
            <p className="px-3 py-2 text-xs text-zinc-500 italic">No pending todos.</p>
          ) : (
            <QueueList>
              {pending.map((todo) => (
                <QueueItem key={todo.id}>
                  <div className="flex items-start gap-2">
                    <QueueItemIndicator completed={false} />
                    <QueueItemContent completed={false}>{todo.title}</QueueItemContent>
                  </div>
                  {todo.description ? (
                    <QueueItemDescription completed={false}>
                      {todo.description}
                    </QueueItemDescription>
                  ) : null}
                </QueueItem>
              ))}
            </QueueList>
          )}
        </QueueSectionContent>
      </QueueSection>

      <QueueSection defaultOpen>
        <QueueSectionTrigger>
          <QueueSectionLabel
            count={completed.length}
            icon={<CheckCircle2 className="size-4" />}
            label="Completed"
          />
        </QueueSectionTrigger>
        <QueueSectionContent>
          {completed.length === 0 ? (
            <p className="px-3 py-2 text-xs text-zinc-500 italic">No completed todos.</p>
          ) : (
            <QueueList>
              {completed.map((todo) => (
                <QueueItem key={todo.id}>
                  <div className="flex items-start gap-2">
                    <QueueItemIndicator completed />
                    <QueueItemContent completed>{todo.title}</QueueItemContent>
                  </div>
                  {todo.description ? (
                    <QueueItemDescription completed>
                      {todo.description}
                    </QueueItemDescription>
                  ) : null}
                </QueueItem>
              ))}
            </QueueList>
          )}
        </QueueSectionContent>
      </QueueSection>
    </Queue>
  )
}
