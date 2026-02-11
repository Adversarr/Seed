#!/usr/bin/env node

// Load environment variables from .env file
import { config } from 'dotenv'
config({ quiet: true })

import { runCli } from './cli/run.js'
import { defaultIO } from './cli/io.js'

process.exitCode = await runCli({
  argv: process.argv.slice(2),
  defaultWorkspace: process.cwd(),
  io: defaultIO()
})
