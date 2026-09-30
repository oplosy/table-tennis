// Starts the game server and the Vite dev server together; Ctrl+C stops both.
import { spawn } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const children = [
  spawn(npm, ['--workspace', 'server', 'run', 'dev'], { stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn(npm, ['--workspace', 'web', 'run', 'dev'], { stdio: 'inherit', shell: process.platform === 'win32' }),
]

const stop = () => { for (const child of children) child.kill() }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const child of children) child.on('exit', (code) => { if (code) { stop(); process.exitCode = code } })
