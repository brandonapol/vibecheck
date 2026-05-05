#!/usr/bin/env node

const [command] = process.argv.slice(2)

switch (command) {
  case 'init':
  case 'check':
  case 'status':
    console.log(`vibecheck ${command}: not yet implemented`)
    break
  default:
    console.log('Usage: vibecheck <init|check|status>')
    process.exit(1)
}
