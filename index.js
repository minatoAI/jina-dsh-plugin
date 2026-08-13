/**
 * dsh-jina — Jina AI tools for DeepSeek Harness.
 *
 * Host plugin: registers the ten jina_* model tools mirroring jina-cli
 * (search / read / screenshot / datetime / expand / embed / rerank /
 * classify / pdf / primer), plus the `jina-tools` settings namespace that
 * holds the API key and feeds the "Jina Tools" web settings page.
 *
 * The API key is resolved per call in this order:
 *   1. the tool's own `apiKey` parameter,
 *   2. the `jina-tools` settings namespace (set from the web settings page),
 *   3. `jina-api-key.txt` in the calling session's workspace,
 *   4. `jina-api-key.txt` in the dsh home directory (`$DSH_HOME` or `~/.dsh`).
 *
 * Network transport: the Jina endpoints are contacted through a small
 * `node -e` fetch helper spawned via the host `subprocess` service, with
 * NODE_USE_ENV_PROXY enabled so Node's fetch honors the system proxy (the
 * local VPN on Windows). The proxy address is discovered from the WinINET
 * registry settings before each call and rediscovered automatically when a
 * transport failure suggests the proxy port changed.
 */

import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export const name = 'dsh-jina'

export const inject = ['fs', 'subprocess', 'tools']

export function apply(ctx) {
  const READER = 'https://r.jina.ai/'
  const SEARCH = 'https://svip.jina.ai/'
  const API = 'https://api.jina.ai'
  const KEY_FILE = 'jina-api-key.txt'
  const SETTINGS_NS = 'jina-tools'
  const MAX_OUT = 1500000

  const HTTP_SCRIPT = [
    "const fs = require('fs')",
    "let input = ''",
    "process.stdin.setEncoding('utf8')",
    "process.stdin.on('data', function (c) { input += c })",
    "process.stdin.on('end', function () {",
    "  let req = {}",
    "  try { req = JSON.parse(input || '{}') } catch (e) {",
    "    process.stdout.write(JSON.stringify({ ok: false, status: 0, text: 'bad request json: ' + e.message }), function () { process.exit(0) })",
    "    return",
    "  }",
    "  setTimeout(function () { process.exit(1) }, ((req && req.timeoutMs) || 60000) + 20000).unref()",
    "  try {",
    "    const options = { method: req.method || 'POST', headers: req.headers || {}, redirect: 'follow', signal: AbortSignal.timeout(req.timeoutMs || 60000) }",
    "    if (req.body !== undefined && req.body !== null) options.body = req.body",
    "    fetch(req.url, options).then(async function (res) {",
    "      const text = await res.text()",
    "      process.stdout.write(JSON.stringify({ ok: res.status >= 200 && res.status < 300, status: res.status, text: text }), function () { process.exit(0) })",
    "    }).catch(function (err) {",
    "      let detail = (err && err.message) || String(err)",
    "      if (err && err.name === 'TimeoutError') detail = 'timeout after ' + ((req && req.timeoutMs) || 60000) + 'ms'",
    "      if (err && err.cause && err.cause.message) detail = detail + ' (' + err.cause.message + ')'",
    "      process.stdout.write(JSON.stringify({ ok: false, status: 0, text: detail }), function () { process.exit(0) })",
    "    })",
    "  } catch (err) {",
    "    process.stdout.write(JSON.stringify({ ok: false, status: 0, text: 'helper error: ' + ((err && err.message) || String(err)) }), function () { process.exit(0) })",
    "  }",
    "})",
  ].join('\n')

  let nodePath
  let keyCache = { text: undefined, at: 0 }
  let keyDiag = ''
  let proxyCache = { text: undefined, at: 0, done: false }
  let currentCwd = undefined
  let settingsScope = undefined

  /** dsh home directory: $DSH_HOME, else ~/.dsh. */
  function dshHome() {
    if (typeof process !== 'undefined' && process.env && process.env.DSH_HOME) return process.env.DSH_HOME
    return homedir() + '/.dsh'
  }

  function workspaceRoot() {
    const sp = ctx.get('sandboxPolicy')
    if (sp && typeof sp.workspaceRoot === 'string' && sp.workspaceRoot.length > 0) return sp.workspaceRoot
    return homedir()
  }

  /** The calling agent's per-session workspace (canonical: exec.agent.session.header.cwd). */
  function sessionCwdOf(exec) {
    try {
      const c = exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd
      if (typeof c === 'string' && c.length > 0) return c
    } catch (e) { /* guarded */ }
    return undefined
  }

  function resolveRoot() {
    if (currentCwd) return currentCwd
    return workspaceRoot()
  }

  async function resolveNode() {
    if (nodePath === undefined) {
      try { nodePath = await ctx.subprocess.resolveExecutable('node') } catch (err) { nodePath = null }
    }
    return nodePath
  }

  function runCollect(argv, stdinData, maxBytes, env, signal) {
    return new Promise((resolve) => {
      const out = { exitCode: -1, stdout: { text: '' }, stderr: { text: '' } }
      let handle
      try {
        handle = ctx.subprocess.spawn({
          argv,
          cwd: resolveRoot(),
          stdio: {
            stdin: stdinData === undefined ? 'ignore' : { data: stdinData },
            stdout: { maxBytes: maxBytes || 65536, spill: { maxBytes: (maxBytes || 65536) * 4 } },
            stderr: { maxBytes: 65536, spill: { maxBytes: 262144 } },
          },
          graceMs: 2000,
          ...(signal !== undefined ? { signal } : {}),
          ...(env !== undefined ? { env } : {}),
        })
      } catch (err) {
        out.stderr.text = 'spawn failed: ' + String((err && err.message) || err)
        resolve(out)
        return
      }
      const finish = (err) => {
        try {
          if (err) out.stderr.text = String((err && err.message) || err)
          else {
            const so = handle.collected.stdout.readFrom(0)
            const se = handle.collected.stderr.readFrom(0)
            out.exitCode = handle.exitCode
            out.stdout = { text: so.text, lossy: so.lossy, spillPath: so.spillPath }
            out.stderr = { text: se.text }
          }
        } catch (e) { /* keep defaults */ }
        resolve(out)
      }
      handle.done.then(() => finish(null), (err) => finish(err))
    })
  }

  /** The settings namespace value is the live source of truth; the cache only smooths file reads. */
  function settingsKey() {
    try {
      if (settingsScope === undefined) return ''
      const value = settingsScope.get()
      const key = value && typeof value.apiKey === 'string' ? value.apiKey.trim() : ''
      return key
    } catch (err) { return '' }
  }

  /** API key: settings namespace, then workspace file, then dsh-home file. */
  async function loadKey() {
    if (keyCache.text !== undefined && Date.now() - keyCache.at < 30000) return keyCache.text
    let value
    const attempts = []
    try {
      const fromSettings = settingsKey()
      if (fromSettings !== '') { value = fromSettings; attempts.push('settings: found') }
      else attempts.push('settings: not set')
    } catch (err) {
      attempts.push('settings: ' + String((err && err.message) || err))
    }
    if (value === undefined) {
      const root = resolveRoot()
      const home = dshHome()
      const candidates = [
        { kind: 'workspace abs', path: root + '\\' + KEY_FILE, opts: undefined },
        { kind: 'workspace rel+cwd', path: KEY_FILE, opts: { cwd: root } },
        { kind: 'workspace rel', path: KEY_FILE, opts: undefined },
        { kind: 'home abs', path: home + '\\' + KEY_FILE, opts: undefined },
        { kind: 'home rel+cwd', path: KEY_FILE, opts: { cwd: home } },
      ]
      for (const c of candidates) {
        try {
          const target = await ctx.fs.resolve(c.path, c.opts)
          const raw = await ctx.fs.readText(target)
          const trimmed = String(raw).trim()
          if (trimmed !== '') { value = trimmed; attempts.push(c.kind + ': found'); break }
          attempts.push(c.kind + ': empty file')
        } catch (err) {
          attempts.push(c.kind + ': ' + String((err && err.message) || err))
        }
      }
    }
    keyDiag = 'settings ns=' + SETTINGS_NS + ' | ' + attempts.join(' | ')
    keyCache = { text: value, at: Date.now() }
    return value
  }

  /** System proxy (the local VPN): read the user-level WinINET registry settings. */
  async function discoverProxy() {
    if (proxyCache.done && Date.now() - proxyCache.at < 60000) return proxyCache.text
    let proxy
    try {
      const r = await runCollect(['reg.exe', 'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], undefined, 32768)
      const t = r.stdout.text || ''
      if (/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(t)) {
        const m = /ProxyServer\s+REG_SZ\s+([^\r\n]+)/i.exec(t)
        if (m) {
          const raw = m[1].trim()
          const hit = /(?:^|;)\s*https=([^;]+)/i.exec(raw)
          let addr = hit ? hit[1].trim() : raw
          if (!/^https?:\/\//i.test(addr)) addr = 'http://' + addr
          proxy = addr
        }
      }
    } catch (err) { proxy = undefined }
    proxyCache = { text: proxy, at: Date.now(), done: true }
    return proxy
  }

  /** One HTTP call through the node helper. */
  async function jinaRequest(spec) {
    const node = await resolveNode()
    if (!node) return { ok: false, status: 0, text: 'node executable not found on PATH; the helper needs Node.js to make the HTTP call' }
    let proxy
    if (spec.proxy !== undefined && spec.proxy !== null && spec.proxy !== '') {
      proxy = String(spec.proxy)
      if (!/^https?:\/\//i.test(proxy)) proxy = 'http://' + proxy
    } else {
      proxy = await discoverProxy()
    }
    const payload = JSON.stringify({
      url: spec.url,
      method: spec.method || 'POST',
      headers: spec.headers || {},
      body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
      timeoutMs: spec.timeoutMs || 60000,
    })
    const makeEnv = (p) => {
      const env = { NODE_USE_ENV_PROXY: '1', NO_PROXY: '' }
      if (p) { env.HTTPS_PROXY = p; env.HTTP_PROXY = p }
      return env
    }
    const parse = (r) => {
      let parsed
      try { parsed = JSON.parse(r.stdout.text) } catch (e) {
        return { ok: false, status: 0, text: 'helper output not parseable: ' + String(r.stdout.text).slice(0, 300) + (r.stderr.text ? ' [stderr: ' + String(r.stderr.text).slice(0, 300) + ']' : '') }
      }
      if (typeof parsed !== 'object' || parsed === null) return { ok: false, status: 0, text: 'bad helper output: ' + String(r.stdout.text).slice(0, 300) }
      return parsed
    }
    let r = await runCollect([node, '-e', HTTP_SCRIPT], payload, MAX_OUT, makeEnv(proxy), spec.signal)
    let parsed = parse(r)
    if (parsed.ok || parsed.status !== 0) return parsed
    // Transport-level failure: rediscover the proxy (the VPN may have restarted on a new port) and retry once.
    if (spec.proxy === undefined || spec.proxy === null || spec.proxy === '') {
      proxyCache = { text: undefined, at: 0, done: false }
      const proxy2 = await discoverProxy()
      r = await runCollect([node, '-e', HTTP_SCRIPT], payload, MAX_OUT, makeEnv(proxy2), spec.signal)
      parsed = parse(r)
    }
    return parsed
  }

  /** Full call: key handling + auth header + 401 key refresh. */
  async function callJina(opts) {
    const headers = {}
    for (const k of Object.keys(opts.headers || {})) headers[k] = opts.headers[k]
    const explicit = opts.apiKey !== undefined && opts.apiKey !== null && opts.apiKey !== ''
    let key = explicit ? String(opts.apiKey) : await loadKey()
    if (key) headers.Authorization = 'Bearer ' + key
    if (opts.needsKey && !key) {
      return { ok: false, status: 401, text: 'Jina API key required for this command. Set it in the DSH settings page (Jina Tools) or put it in ' + KEY_FILE + ' in the session workspace or the dsh home directory (one line). Get a free key at https://jina.ai/?sui=apikey' + (keyDiag ? ' [key lookup: ' + keyDiag + ']' : '') }
    }
    let res = await jinaRequest({ url: opts.url, method: opts.method || 'POST', headers, body: opts.body, timeoutMs: opts.timeoutMs, signal: opts.signal, ...(opts.proxy !== undefined ? { proxy: opts.proxy } : {}) })
    if (!res.ok && res.status === 401 && !explicit) {
      keyCache = { text: undefined, at: 0 }
      const fresh = await loadKey()
      if (fresh && fresh !== key) {
        headers.Authorization = 'Bearer ' + fresh
        res = await jinaRequest({ url: opts.url, method: opts.method || 'POST', headers, body: opts.body, timeoutMs: opts.timeoutMs, signal: opts.signal, ...(opts.proxy !== undefined ? { proxy: opts.proxy } : {}) })
      }
    }
    return res
  }

  function describeJinaError(res) {
    const status = res.status || 0
    const body = String(res.text || '').slice(0, 800)
    const hints = {
      0: 'No response from the Jina API (network/VPN problem). Check that the local VPN and its system proxy are enabled, then retry.',
      401: 'Invalid or expired API key. Fix: update it in the DSH settings page (Jina Tools) or the key file. Get a free key: https://jina.ai/?sui=apikey',
      402: 'API quota exhausted. Fix: top up credits at https://jina.ai/api-dashboard/billing',
      422: 'Invalid request parameters.',
      429: 'Rate limit hit. Wait a few seconds and retry, or add an API key for higher limits.',
    }
    let msg = 'Jina API error (HTTP ' + status + '). ' + (hints[status] || '')
    if (status >= 500) msg = 'Jina API server error (HTTP ' + status + '). Retry in a moment; status: https://status.jina.ai'
    if (body) msg += '\nServer said: ' + body
    return msg
  }

  /** Per-call session workspace + signal; run at the top of every execute. */
  const enterExec = (exec) => {
    const cwd = sessionCwdOf(exec)
    if (cwd !== undefined) currentCwd = cwd
    return (exec && exec.signal) || undefined
  }

  function fmtSearch(text, asJson) {
    if (asJson) return text
    let data
    try { data = JSON.parse(text) } catch (e) { return text }
    const results = data && Array.isArray(data.results) ? data.results : undefined
    if (results === undefined) return text
    if (results.length === 0) return '(no results)'
    const lines = []
    for (const r of results) {
      if (r && typeof r === 'object') {
        lines.push(String(r.title || '(untitled)'))
        if (r.url) lines.push('  ' + String(r.url))
        if (r.snippet) lines.push('  ' + String(r.snippet))
      } else {
        lines.push(String(r))
      }
      lines.push('')
    }
    return lines.join('\n').trim()
  }

  function fmtScreenshot(text) {
    try {
      const data = JSON.parse(text)
      const d = data && typeof data === 'object' ? (data.data || data) : data
      if (d && typeof d === 'object') {
        const u = d.screenshotUrl || d.pageshotUrl || d.url
        if (typeof u === 'string' && u.length > 0) return 'screenshot URL: ' + u
        const b64 = d.screenshot || d.image
        if (typeof b64 === 'string' && b64.length > 0) return 'screenshot returned as embedded base64 image data (' + b64.length + ' chars)'
      }
    } catch (e) { /* fall through */ }
    return text
  }

  function fmtExpand(text, asJson) {
    if (asJson) return text
    try {
      const data = JSON.parse(text)
      const list = Array.isArray(data) ? data : (data && (data.results || data.data))
      if (Array.isArray(list)) {
        const lines = []
        for (const r of list) {
          if (typeof r === 'string') lines.push(r)
          else if (r && typeof r === 'object') lines.push(String(r.query || r.text || ''))
        }
        const filtered = lines.filter((l) => l && l.length > 0)
        if (filtered.length > 0) return filtered.join('\n')
      }
    } catch (e) { /* fall through */ }
    return text
  }

  function fmtEmbed(text, asJson) {
    if (asJson) return text
    try {
      const data = JSON.parse(text)
      const items = Array.isArray(data) ? data : (data && data.data)
      if (Array.isArray(items)) {
        const lines = []
        items.forEach((item, i) => {
          const emb = item && Array.isArray(item.embedding) ? item.embedding : item
          if (Array.isArray(emb)) {
            const preview = emb.slice(0, 5).map((v) => Number(v).toFixed(6)).join(', ')
            lines.push('[' + (item && item.index !== undefined ? item.index : i) + '] dim=' + emb.length + ' [' + preview + ', ...]')
          }
        })
        if (lines.length > 0) return lines.join('\n')
      }
    } catch (e) { /* fall through */ }
    return text
  }

  function fmtRerank(text, documents, asJson) {
    if (asJson) return text
    try {
      const data = JSON.parse(text)
      const results = Array.isArray(data) ? data : (data && (data.results || data.data))
      if (Array.isArray(results)) {
        const lines = []
        for (const r of results) {
          if (!r || typeof r !== 'object') continue
          const idx = r.index !== undefined ? Number(r.index) : 0
          const score = r.relevance_score !== undefined ? r.relevance_score : r.score
          let t = (r.document && r.document.text) || (documents && documents[idx]) || ''
          if (typeof t === 'string' && t.length > 200) t = t.slice(0, 200) + '...'
          lines.push('[' + (typeof score === 'number' ? score.toFixed(4) : String(score)) + '] ' + t)
        }
        if (lines.length > 0) return lines.join('\n')
      }
    } catch (e) { /* fall through */ }
    return text
  }

  function fmtClassify(text, asJson) {
    if (asJson) return text
    try {
      const data = JSON.parse(text)
      const items = Array.isArray(data) ? data : (data && (data.data || data.results))
      if (Array.isArray(items)) {
        const lines = []
        for (const item of items) {
          if (!item || typeof item !== 'object') continue
          const pred = item.prediction !== undefined ? item.prediction : (Array.isArray(item.predictions) && item.predictions[0] !== undefined ? item.predictions[0] : '')
          const score = item.score !== undefined ? item.score : item.confidence
          lines.push(String(pred) + (typeof score === 'number' ? ' (' + score.toFixed(4) + ')' : ''))
        }
        if (lines.length > 0) return lines.join('\n')
      }
    } catch (e) { /* fall through */ }
    return text
  }

  function fmtPdf(text, asJson) {
    if (asJson) return text
    try {
      const data = JSON.parse(text)
      const meta = data && data.meta ? data.meta : {}
      const floats = data && Array.isArray(data.floats) ? data.floats : []
      const lines = []
      lines.push('Pages: ' + (meta.num_pages !== undefined ? meta.num_pages : '?'))
      lines.push('Extracted items: ' + (meta.num_floats !== undefined ? meta.num_floats : floats.length))
      for (const f of floats) {
        if (!f || typeof f !== 'object') continue
        const parts = [f.type || 'unknown']
        if (f.number) parts.push(String(f.number))
        lines.push('  [' + parts.join(' ') + '] page ' + (f.page !== undefined ? f.page : '?'))
        if (f.caption) lines.push('    ' + String(f.caption))
      }
      return lines.join('\n')
    } catch (e) { /* fall through */ }
    return text
  }

  // ---- settings namespace (feeds the web settings page) --------------------
  const settingsService = ctx.get('settings')

  /**
   * Load `@deepseek-ai/schemastery` robustly.
   *
   * A git/npm install lands this package as a real directory inside the
   * profile's node_modules, so a plain dynamic import resolves it through
   * the profile's parent-walk (the healed `$DSH_HOME/profiles/node_modules`
   * fallback carries schemastery as a dependency of the base bundle).
   * A local `link:` install keeps this package's real path outside the
   * profile, so the fallback anchors a createRequire at the dsh home
   * instead — that walk always reaches `$DSH_HOME/profiles/node_modules`.
   */
  async function loadSchemastery() {
    try {
      const m = await import('@deepseek-ai/schemastery')
      const z = m && (m.default ?? m.z ?? m)
      if (z && typeof z.object === 'function') return z
    } catch (err) { /* try the anchored fallback */ }
    const req = createRequire(dshHome() + '/profiles/placeholder.cjs')
    const entry = req.resolve('@deepseek-ai/schemastery')
    const m = await import(pathToFileURL(entry).href)
    const z = m && (m.default ?? m.z ?? m)
    if (z === undefined || typeof z.object !== 'function') throw new Error('unexpected schemastery module shape')
    return z
  }

  const setupSettings = async () => {
    if (settingsService === undefined) return
    let z
    try {
      z = await loadSchemastery()
    } catch (err) {
      try { ctx.logger.warn('dsh-jina: settings namespace disabled (schemastery unavailable): ' + String((err && err.message) || err)) } catch (e) { /* no logger */ }
      return
    }
    try {
      settingsScope = settingsService.register(
        SETTINGS_NS,
        z.object({ apiKey: z.string() }),
        { base: { apiKey: '' } },
      )
    } catch (err) {
      try { ctx.logger.warn('dsh-jina: settings namespace registration failed: ' + String((err && err.message) || err)) } catch (e) { /* no logger */ }
    }
  }
  void setupSettings()

  // A key saved from the settings page invalidates the cached key immediately.
  ctx.on('settings/updated', (ns) => {
    if (ns === SETTINGS_NS) keyCache = { text: undefined, at: 0 }
  })

  // ---- tool registration ---------------------------------------------------
  const OUT = {
    schema: { type: 'string' },
    render(_args, value) { return [{ type: 'text', text: value }] },
  }

  ctx.tools.register({
    name: 'jina_search',
    description: 'Search the web via Jina AI (https://jina.ai), mirroring the jina-cli \'search\' command. Supports web (default), arxiv, ssrn, images and blog domains, a time filter, country/language hints, and result count. Requires a Jina API key (set in the DSH settings page "Jina Tools", a key file, or the apiKey parameter).',
    parameters: {
      query: { type: 'string', required: true, description: 'Search query.' },
      type: { type: 'string', enum: ['web', 'arxiv', 'ssrn', 'images', 'blog'], description: 'Search domain. Default: web.' },
      num: { type: 'number', description: 'Number of results. Default: 5.' },
      time: { type: 'string', enum: ['h', 'd', 'w', 'm', 'y'], description: 'Only results from the last hour/day/week/month/year.' },
      location: { type: 'string', description: 'Location hint for search results.' },
      gl: { type: 'string', description: 'Country code, e.g. us, de, jp.' },
      hl: { type: 'string', description: 'Language code, e.g. en, zh-cn.' },
      json: { type: 'boolean', description: 'Return the raw JSON response instead of formatted results.' },
      apiKey: { type: 'string', description: 'Optional Jina API key override.' },
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      const body = { q: String(args.query) }
      if (args.type === 'arxiv') body.domain = 'arxiv'
      else if (args.type === 'ssrn') body.domain = 'ssrn'
      else if (args.type === 'images') body.type = 'images'
      else if (args.type === 'blog') body.q = 'site:jina.ai/news ' + String(args.query)
      if (args.num !== undefined) body.num = args.num
      if (args.time) body.tbs = 'qdr:' + args.time
      if (args.location) body.location = args.location
      if (args.gl) body.gl = args.gl
      if (args.hl) body.hl = args.hl
      const res = await callJina({
        url: SEARCH, method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body, timeoutMs: 60000, needsKey: true, apiKey: args.apiKey, signal,
      })
      if (!res.ok) return describeJinaError(res)
      return fmtSearch(res.text, args.json === true)
    },
  })

  ctx.tools.register({
    name: 'jina_read',
    description: 'Read a web page and extract clean markdown via Jina Reader (r.jina.ai), mirroring the jina-cli \'read\' command. Works without an API key (rate-limited); pass a key for higher limits. Use links/images to include link/image summaries.',
    parameters: {
      url: { type: 'string', required: true, description: 'Page URL, starting with http:// or https://.' },
      links: { type: 'boolean', description: 'Include hyperlinks in the output.' },
      images: { type: 'boolean', description: 'Include image summaries in the output.' },
      json: { type: 'boolean', description: 'Return the raw JSON response instead of markdown.' },
      apiKey: { type: 'string', description: 'Optional Jina API key override.' },
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      if (!/^https?:\/\//i.test(String(args.url))) return 'invalid url: ' + args.url + ' (must start with http:// or https://)'
      const headers = {
        Accept: args.json ? 'application/json' : 'text/markdown',
        'Content-Type': 'application/json',
        'X-Md-Link-Style': 'discarded',
      }
      if (args.links) headers['X-With-Links-Summary'] = 'all'
      if (args.images) headers['X-With-Images-Summary'] = 'true'
      else headers['X-Retain-Images'] = 'none'
      const res = await callJina({
        url: READER, method: 'POST', headers,
        body: { url: String(args.url) }, timeoutMs: 120000, needsKey: false, apiKey: args.apiKey, signal,
      })
      if (!res.ok) return describeJinaError(res)
      return res.text
    },
  })

  ctx.tools.register({
    name: 'jina_screenshot',
    description: 'Capture a screenshot of a web page via Jina (r.jina.ai), mirroring the jina-cli \'screenshot\' command. Returns the hosted screenshot URL. Requires a Jina API key.',
    parameters: {
      url: { type: 'string', required: true, description: 'Page URL, starting with http:// or https://.' },
      fullPage: { type: 'boolean', description: 'Capture the full page instead of the viewport.' },
      apiKey: { type: 'string', description: 'Optional Jina API key override.' },
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      if (!/^https?:\/\//i.test(String(args.url))) return 'invalid url: ' + args.url + ' (must start with http:// or https://)'
      const res = await callJina({
        url: READER, method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Return-Format': args.fullPage ? 'pageshot' : 'screenshot' },
        body: { url: String(args.url) }, timeoutMs: 120000, needsKey: true, apiKey: args.apiKey, signal,
      })
      if (!res.ok) return describeJinaError(res)
      return fmtScreenshot(res.text)
    },
  })

  ctx.tools.register({
    name: 'jina_datetime',
    description: 'Guess the publish/update datetime of a URL via Jina (r.jina.ai), mirroring the jina-cli \'datetime\' command. Works without an API key.',
    parameters: {
      url: { type: 'string', required: true, description: 'Page URL, starting with http:// or https://.' },
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      if (!/^https?:\/\//i.test(String(args.url))) return 'invalid url: ' + args.url + ' (must start with http:// or https://)'
      const res = await callJina({
        url: READER, method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Return-Format': 'datetime' },
        body: { url: String(args.url) }, timeoutMs: 60000, needsKey: false, signal,
      })
      if (!res.ok) return describeJinaError(res)
      return res.text
    },
  })

  ctx.tools.register({
    name: 'jina_expand',
    description: 'Expand a search query into related queries via Jina, mirroring the jina-cli \'expand\' command. Requires a Jina API key.',
    parameters: {
      query: { type: 'string', required: true, description: 'The query to expand.' },
      json: { type: 'boolean', description: 'Return the raw JSON response instead of formatted queries.' },
      apiKey: { type: 'string', description: 'Optional Jina API key override.' },
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      const res = await callJina({
        url: SEARCH, method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: { q: String(args.query), query_expansion: true }, timeoutMs: 60000, needsKey: true, apiKey: args.apiKey, signal,
      })
      if (!res.ok) return describeJinaError(res)
      return fmtExpand(res.text, args.json === true)
    },
  })

  ctx.tools.register({
    name: 'jina_embed',
    description: 'Generate embeddings for texts via Jina Embeddings API, mirroring the jina-cli \'embed\' command. Requires a Jina API key. Default model: jina-embeddings-v5-text-small.',
    parameters: {
      texts: { type: 'array', items: { type: 'string' }, required: true, description: 'Texts to embed (up to a few hundred).' },
      model: { type: 'string', description: 'Embedding model. Default: jina-embeddings-v5-text-small.' },
      task: { type: 'string', description: 'Embedding task type. Default: text-matching.' },
      dimensions: { type: 'number', description: 'Optional output dimensions (Matryoshka).' },
      json: { type: 'boolean', description: 'Return the raw JSON response (full vectors) instead of a preview.' },
      apiKey: { type: 'string', description: 'Optional Jina API key override.' },
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      const body = { model: args.model || 'jina-embeddings-v5-text-small', task: args.task || 'text-matching', input: args.texts }
      if (args.dimensions !== undefined) body.dimensions = args.dimensions
      const res = await callJina({
        url: API + '/v1/embeddings', method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body, timeoutMs: 90000, needsKey: true, apiKey: args.apiKey, signal,
      })
      if (!res.ok) return describeJinaError(res)
      return fmtEmbed(res.text, args.json === true)
    },
  })

  ctx.tools.register({
    name: 'jina_rerank',
    description: 'Rerank documents by relevance to a query via Jina Reranker API, mirroring the jina-cli \'rerank\' command. Requires a Jina API key. Default model: jina-reranker-v3.5.',
    parameters: {
      query: { type: 'string', required: true, description: 'The reference query.' },
      documents: { type: 'array', items: { type: 'string' }, required: true, description: 'Documents (strings) to rerank.' },
      topN: { type: 'number', description: 'Maximum number of results to return.' },
      model: { type: 'string', description: 'Reranker model. Default: jina-reranker-v3.5.' },
      json: { type: 'boolean', description: 'Return the raw JSON response instead of formatted results.' },
      apiKey: { type: 'string', description: 'Optional Jina API key override.' },
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      const body = { model: args.model || 'jina-reranker-v3.5', query: String(args.query), documents: args.documents }
      if (args.topN !== undefined) body.top_n = args.topN
      const res = await callJina({
        url: API + '/v1/rerank', method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body, timeoutMs: 90000, needsKey: true, apiKey: args.apiKey, signal,
      })
      if (!res.ok) return describeJinaError(res)
      return fmtRerank(res.text, args.documents, args.json === true)
    },
  })

  ctx.tools.register({
    name: 'jina_classify',
    description: 'Classify texts into labels via Jina Classify API, mirroring the jina-cli \'classify\' command. Requires a Jina API key. Default model: jina-embeddings-v5-text-small.',
    parameters: {
      texts: { type: 'array', items: { type: 'string' }, required: true, description: 'Texts to classify.' },
      labels: { type: 'array', items: { type: 'string' }, required: true, description: 'Candidate labels.' },
      model: { type: 'string', description: 'Embedding model used for classification. Default: jina-embeddings-v5-text-small.' },
      json: { type: 'boolean', description: 'Return the raw JSON response instead of formatted predictions.' },
      apiKey: { type: 'string', description: 'Optional Jina API key override.' },
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      const body = { model: args.model || 'jina-embeddings-v5-text-small', input: args.texts, labels: args.labels }
      const res = await callJina({
        url: API + '/v1/classify', method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body, timeoutMs: 90000, needsKey: true, apiKey: args.apiKey, signal,
      })
      if (!res.ok) return describeJinaError(res)
      return fmtClassify(res.text, args.json === true)
    },
  })

  ctx.tools.register({
    name: 'jina_pdf',
    description: 'Extract figures, tables and equations from a PDF via Jina (extract-pdf), mirroring the jina-cli \'pdf\' command. Provide either url or arxivId. Requires a Jina API key.',
    parameters: {
      url: { type: 'string', description: 'PDF URL (https).' },
      arxivId: { type: 'string', description: 'arXiv paper ID shorthand, e.g. 2301.12345.' },
      extractType: { type: 'string', description: 'Filter by type: figure, table, equation (comma-separated).' },
      maxEdge: { type: 'number', description: 'Max pixel size for extracted images. Default: 1024.' },
      json: { type: 'boolean', description: 'Return the raw JSON response instead of formatted output.' },
      apiKey: { type: 'string', description: 'Optional Jina API key override.' },
    },
    output: OUT,
    async execute(args, exec) {
      const signal = enterExec(exec)
      const body = { max_edge: args.maxEdge !== undefined ? args.maxEdge : 1024 }
      if (args.arxivId) body.id = String(args.arxivId)
      else if (args.url) body.url = String(args.url)
      else return 'provide either url or arxivId (jina pdf URL_OR_ARXIV_ID)'
      if (args.extractType) body.type = args.extractType
      const res = await callJina({
        url: SEARCH + 'extract-pdf', method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body, timeoutMs: 120000, needsKey: true, apiKey: args.apiKey, signal,
      })
      if (!res.ok) return describeJinaError(res)
      return fmtPdf(res.text, args.json === true)
    },
  })

  ctx.tools.register({
    name: 'jina_primer',
    description: 'Get context info (current time, location, network facts) via Jina (r.jina.ai), mirroring the jina-cli \'primer\' command. Works without an API key.',
    parameters: {},
    output: OUT,
    async execute(_args, exec) {
      const signal = enterExec(exec)
      const res = await callJina({
        url: READER, method: 'GET',
        headers: { Accept: 'application/json' },
        body: undefined, timeoutMs: 60000, needsKey: false, signal,
      })
      if (!res.ok) return describeJinaError(res)
      return res.text
    },
  })
}
