import React from 'react'
import { InputStrategy } from './InputStrategy.js'
import { SelectStrategy } from './SelectStrategy.js'
import type { UserInteractionRequestedPayload } from '../../../domain/events.js'

export interface StrategyAdapterProps {
  options?: UserInteractionRequestedPayload['options']
  onSubmit: (optionId?: string, inputValue?: string) => void
}

const InputAdapter: React.FC<StrategyAdapterProps> = ({ onSubmit }) => (
  <InputStrategy onSubmit={(val) => onSubmit(undefined, val)} />
)

const SelectAdapter: React.FC<StrategyAdapterProps> = ({ options, onSubmit }) => (
  <SelectStrategy options={options || []} onSubmit={(id) => onSubmit(id, undefined)} />
)

export const INTERACTION_STRATEGIES: Record<string, React.FC<StrategyAdapterProps>> = {
  Input: InputAdapter,
  Confirm: SelectAdapter,
  Select: SelectAdapter,
}
