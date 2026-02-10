/**
 * `coauthor serve` — Start HTTP+WS server in headless mode (no TUI).
 *
 * Useful for running as a background service or when only Web UI is needed.
 */

import { type Argv } from 'yargs'
import type { App } from '../../app/createApp.js'
import type { IO } from '../io.js'

export function registerServeCommand(
  parser: Argv,
  app: App,
  io: IO,
  startServer: () => Promise<void>,
): Argv {
  return parser.command(
    'serve',
    'Start Web UI server (headless, no TUI)',
    (y: Argv) => y,
    async () => {
      await startServer()
      io.stdout(`Press Ctrl+C to stop.\n`)

      // Start runtime manager
      app.runtimeManager.start()

      // Keep alive
      await new Promise(() => {}) // Never resolves — server runs until killed
    },
  )
}
