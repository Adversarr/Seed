#!/usr/bin/env node

import { runCli } from './cli/run.js'
import { defaultIO } from './cli/io.js'

process.exitCode = await runCli({
  argv: process.argv.slice(2),
  baseDir: process.cwd(),
  io: defaultIO()
})
