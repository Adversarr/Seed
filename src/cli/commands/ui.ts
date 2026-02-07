import { type Argv, type Arguments } from 'yargs'
import { createApp, type App } from '../../app/createApp.js'

export function registerUiCommand(parser: Argv, app: App, defaultBaseDir: string): Argv {
  return parser.command('ui [baseDir]', 'Start Ink UI', (y: Argv) => y.positional('baseDir', { type: 'string' }), async (args: Arguments) => {
    const baseDirArgument = typeof args.baseDir === 'string' ? args.baseDir.trim() : ''
    const baseDir = baseDirArgument || defaultBaseDir
    const appForUi = baseDir === app.baseDir ? app : await createApp({ baseDir })
    const { runMainTui } = await import('../../tui/run.js')
    await runMainTui(appForUi)
  })
}
