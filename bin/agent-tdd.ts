#!/usr/bin/env node

const [command] = process.argv.slice(2)

switch (command) {
  case 'init':
  case 'check':
  case 'status':
    console.log(`agent-tdd ${command}: not yet implemented`)
    break
  default:
    console.log('Usage: agent-tdd <init|check|status>')
    process.exit(1)
}
