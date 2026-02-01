import React from 'react'
import { render } from 'ink'
import type { App } from '../app/createApp.js'
import { MainTui } from './main.js'

export async function runMainTui(app: App): Promise<void> {
  render(React.createElement(MainTui, { app }))
}
