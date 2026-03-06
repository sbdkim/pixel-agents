#!/usr/bin/env node
/**
 * Pixel Agents tileset import helper.
 *
 * Usage:
 *   npx tsx scripts/0-import-tileset.ts
 */

import * as readline from 'readline'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve))
}

function printMenu(): void {
  console.log('\nPixel Agents Tileset Import\n')
  console.log('1. Stage 1 - Detect assets (scripts/1-detect-assets.ts)')
  console.log('2. Stage 2 - Edit assets (scripts/2-asset-editor.html)')
  console.log('3. Stage 3 - Generate metadata draft (scripts/3-vision-inspect.ts)')
  console.log('4. Stage 4 - Review metadata (scripts/4-review-metadata.html)')
  console.log('5. Stage 5 - Export assets (scripts/5-export-assets.ts)')
  console.log('6. Exit\n')
}

function printCommand(choice: string): void {
  switch (choice) {
    case '1':
      console.log('\nRun: npx tsx scripts/1-detect-assets.ts\n')
      return
    case '2':
      console.log('\nOpen: scripts/2-asset-editor.html\n')
      return
    case '3':
      console.log('\nRun: npx tsx scripts/3-vision-inspect.ts\n')
      return
    case '4':
      console.log('\nOpen: scripts/4-review-metadata.html\n')
      return
    case '5':
      console.log('\nRun: npx tsx scripts/5-export-assets.ts\n')
      return
    default:
      console.log('\nInvalid selection\n')
  }
}

async function main(): Promise<void> {
  let done = false
  while (!done) {
    printMenu()
    const choice = (await ask('Select option: ')).trim()
    if (choice === '6') {
      done = true
    } else {
      printCommand(choice)
      await ask('Press Enter to continue...')
    }
  }
  rl.close()
}

main().catch((err) => {
  console.error(err)
  rl.close()
  process.exit(1)
})
