const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FORBIDDEN_PATTERNS = [
  /\bClaude\b/,
  /\bclaude\b/,
  /\banthropic\b/i,
  /(^|[\\/])\.claude([\\/]|$)/,
  /\bopenClaude\b/,
];

const STALE_PHASE2_PATTERNS = [
  /Sub-agent support is removed/i,
  /single-agent tracking only/i,
  /removed for now in Codex mode/i,
];

function listTrackedFiles() {
  const git = spawnSync('git', ['ls-files'], { encoding: 'utf8' });
  if (git.status !== 0) {
    throw new Error(`git ls-files failed: ${git.stderr || git.stdout}`);
  }
  return git.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => file !== 'scripts/release-gate.js')
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return [
        '.ts',
        '.tsx',
        '.js',
        '.mjs',
        '.cjs',
        '.json',
        '.md',
        '.css',
        '.html',
      ].includes(ext);
    });
}

function scan(patterns, files, label) {
  const hits = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of patterns) {
        if (pattern.test(lines[i])) {
          hits.push(`${file}:${i + 1}: ${label} match "${pattern}" -> ${lines[i].trim()}`);
        }
      }
    }
  }
  return hits;
}

function main() {
  const files = listTrackedFiles();
  const forbiddenHits = scan(FORBIDDEN_PATTERNS, files, 'forbidden');
  const staleHits = scan(STALE_PHASE2_PATTERNS, files, 'stale-phase2');
  const hits = [...forbiddenHits, ...staleHits];
  if (hits.length > 0) {
    console.error('Release gate failed. Found forbidden/stale terms:\n');
    for (const hit of hits) {
      console.error(`- ${hit}`);
    }
    process.exit(1);
  }
  console.log('Release gate passed: no forbidden or stale phase-2 terms found.');
}

main();
