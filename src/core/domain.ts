import { z } from 'zod'

export const TaskCreatedPayloadSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1)
})

export const ThreadOpenedPayloadSchema = z.object({
  taskId: z.string().min(1)
})

export const PatchProposedPayloadSchema = z.object({
  taskId: z.string().min(1),
  proposalId: z.string().min(1),
  targetPath: z.string().min(1),
  patchText: z.string().min(1)
})

export const PatchAppliedPayloadSchema = z.object({
  taskId: z.string().min(1),
  proposalId: z.string().min(1),
  targetPath: z.string().min(1),
  patchText: z.string().min(1),
  appliedAt: z.string().min(1)
})

export const EventTypeSchema = z.enum([
  'TaskCreated',
  'ThreadOpened',
  'PatchProposed',
  'PatchApplied'
])

export type EventType = z.infer<typeof EventTypeSchema>

export type TaskCreatedPayload = z.infer<typeof TaskCreatedPayloadSchema>
export type ThreadOpenedPayload = z.infer<typeof ThreadOpenedPayloadSchema>
export type PatchProposedPayload = z.infer<typeof PatchProposedPayloadSchema>
export type PatchAppliedPayload = z.infer<typeof PatchAppliedPayloadSchema>

export type DomainEvent =
  | { type: 'TaskCreated'; payload: TaskCreatedPayload }
  | { type: 'ThreadOpened'; payload: ThreadOpenedPayload }
  | { type: 'PatchProposed'; payload: PatchProposedPayload }
  | { type: 'PatchApplied'; payload: PatchAppliedPayload }

export type StoredEvent = DomainEvent & {
  id: number
  streamId: string
  seq: number
  createdAt: string
}

export const DomainEventSchema: z.ZodType<DomainEvent> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TaskCreated'), payload: TaskCreatedPayloadSchema }),
  z.object({ type: z.literal('ThreadOpened'), payload: ThreadOpenedPayloadSchema }),
  z.object({ type: z.literal('PatchProposed'), payload: PatchProposedPayloadSchema }),
  z.object({ type: z.literal('PatchApplied'), payload: PatchAppliedPayloadSchema })
])

export function parseDomainEvent(input: unknown): DomainEvent {
  return DomainEventSchema.parse(input)
}
