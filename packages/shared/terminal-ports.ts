/**
 * Terminal facts the AI needs to avoid duplicating a dev server:
 *  - which ports a terminal is serving (parsed from its own output)
 *  - whether a command is a long-running server rather than a one-shot check
 *
 * Pure string helpers: main process uses them for `desktop_terminal`, tests can exercise
 * every pattern without a pty.
 */

const LISTENING_PATTERNS = [
  // Vite / Next / Nuxt / Astro / most dev servers: "Local:  http://localhost:3019/"
  // No leading \b: ANSI colour codes glue text (`[36mhttp`) so a word boundary never matches.
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[\w.-]+):(\d{2,5})/gi,
  // Express / Fastify / Nest style: "Server listening on port 3001"
  /(?:listening|serving|running)[^\r\n]{0,40}?\bport\s+(\d{2,5})/gi,
  // "listening at :3001" / "listening on http://[::1]:3001"
  /(?:listening|serving)[^\r\n]{0,30}?\bat\s+[^:\r\n]{0,24}:(\d{2,5})/gi,
  // "EADDRINUSE: address already in use 0.0.0.0:3019"
  /EADDRINUSE[^\r\n]{0,80}?(\d{2,5})/gi,
  /(?:^|[^\d])port\s+(\d{2,5})\s+(?:is\s+)?(?:already\s+)?in\s+use/gi,
]

/** Distinct listening ports mentioned in terminal output, newest last (max `limit`). */
export function detectListeningPorts(output: string, limit = 4): number[] {
  if (!output) return []
  const seen = new Map<number, number>()
  for (const pattern of LISTENING_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of output.matchAll(pattern)) {
      const port = Number(match[1])
      if (!Number.isInteger(port) || port < 1 || port > 65535) continue
      seen.set(port, match.index ?? 0)
    }
  }
  return [...seen.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([port]) => port)
    .slice(-limit)
}

const PACKAGE_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const DEV_SCRIPTS = new Set(['dev', 'develop', 'start', 'serve', 'preview', 'watch', 'storybook'])
const SERVER_BINARIES = new Set([
  'vite', 'next', 'nuxt', 'astro', 'remix', 'ng', 'webpack', 'webpack-dev-server', 'parcel',
  'nodemon', 'ts-node-dev', 'tsx', 'serve', 'http-server', 'live-server', 'json-server',
  'uvicorn', 'gunicorn', 'hypercorn', 'flask', 'django-admin', 'manage.py', 'rails', 'puma',
  'php', 'dotnet', 'spring-boot', 'quarkus', 'mvn', 'gradle',
])

/**
 * True for commands that keep a port open (a dev server you must stop before running again),
 * false for one-shot checks (`tsc`, `npm test`, `git status`, …) that end on their own.
 */
export function isServerCommand(command: string, args: readonly unknown[] = []): boolean {
  const bin = String(command ?? '').trim().toLowerCase().replace(/\.(cmd|exe|bat|ps1)$/u, '')
  const rest = args.map((arg) => String(arg).trim().toLowerCase()).filter(Boolean)
  if (!bin) return false
  if (PACKAGE_RUNNERS.has(bin)) {
    const script = rest[0] === 'run' ? rest[1] : rest[0]
    return !!script && DEV_SCRIPTS.has(script)
  }
  if (bin === 'python' || bin === 'python3' || bin === 'py') {
    return rest[0] === '-m' && (rest[1] === 'http.server' || rest[1] === 'uvicorn')
  }
  // `npx vite` / `pnpm dlx next dev`
  if (bin === 'npx' || bin === 'dlx' || bin === 'exec') {
    return rest.length > 0 && isServerCommand(rest[0], rest.slice(1))
  }
  // e.g. `mvn spring-boot:run`, `dotnet run`, `rails server`, `php artisan serve`
  if (rest.some((arg) => arg === 'run' || arg === 'serve' || arg === 'server' || arg === 'dev')) {
    return SERVER_BINARIES.has(bin) || bin === 'artisan'
  }
  return SERVER_BINARIES.has(bin)
}
