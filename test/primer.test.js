/**
 * Unit tests for the jina_primer improvement (TDD: written first, RED).
 *
 * Contract under test (primer.js — pure helpers):
 *   - parseJinaRoot(text)  : r.jina.ai root JSON -> { authenticatedAs, balanceLeft } | null
 *   - parseIpInfo(text)    : ipinfo.io JSON -> { ip, city, region, country, org, timezone, loc } | null
 *   - buildPrimer({now,jina,network}) : compose { time, jina, network } with host clock facts
 *   - formatPrimer(data, asJson) : text or JSON rendering, never emits "undefined"
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPrimer, formatPrimer, formatUtcOffset, parseIpInfo, parseJinaRoot } from '../primer.js'

// Real shape captured from GET https://r.jina.ai/ (Accept: application/json)
const JINA_ROOT_FIXTURE = '{"code":200,"status":20000,"data":{"usage1":"https://r.jina.ai/YOUR_URL","usage2":"https://s.jina.ai/YOUR_SEARCH_QUERY","homepage":"https://jina.ai/reader","authenticatedAs":"acct-0d821283 (auto-key)","balanceLeft":8522479}}'

// Real shape of GET https://ipinfo.io/json (free, no key)
const IPINFO_FIXTURE = '{"ip":"1.2.3.4","hostname":"no-reverse-dns","city":"Shanghai","region":"Shanghai","country":"CN","loc":"31.2222,121.4581","org":"AS4134 CHINANET-BACKBONE","postal":"200000","timezone":"Asia/Shanghai","readme":"https://ipinfo.io/missingauth"}'

test('parseJinaRoot: valid r.jina.ai root payload', () => {
  const r = parseJinaRoot(JINA_ROOT_FIXTURE)
  assert.equal(r.authenticatedAs, 'acct-0d821283 (auto-key)')
  assert.equal(r.balanceLeft, 8522479)
})

test('parseJinaRoot: invalid JSON returns null', () => {
  assert.equal(parseJinaRoot('not json at all'), null)
})

test('parseJinaRoot: missing data section returns null', () => {
  assert.equal(parseJinaRoot('{"code":200,"status":20000}'), null)
})

test('parseJinaRoot: missing balance tolerates null balance', () => {
  const r = parseJinaRoot('{"code":200,"data":{"authenticatedAs":"acct-x"}}')
  assert.equal(r.authenticatedAs, 'acct-x')
  assert.equal(r.balanceLeft, null)
})

test('parseIpInfo: valid ipinfo payload', () => {
  const r = parseIpInfo(IPINFO_FIXTURE)
  assert.equal(r.ip, '1.2.3.4')
  assert.equal(r.city, 'Shanghai')
  assert.equal(r.country, 'CN')
  assert.equal(r.org, 'AS4134 CHINANET-BACKBONE')
  assert.equal(r.timezone, 'Asia/Shanghai')
})

test('parseIpInfo: invalid JSON returns null', () => {
  assert.equal(parseIpInfo('<html>blocked</html>'), null)
})

test('parseIpInfo: payload without ip returns null', () => {
  assert.equal(parseIpInfo('{"error":"rate limited"}'), null)
})

test('buildPrimer: time facts derive from the given clock', () => {
  const now = new Date('2026-08-16T10:23:45+08:00')
  const d = buildPrimer({ now, jina: null, network: null })
  assert.equal(d.time.iso, now.toISOString())
  assert.equal(d.time.unix, Math.floor(now.getTime() / 1000))
  assert.equal(d.time.utcOffsetMinutes, -now.getTimezoneOffset())
  assert.equal(typeof d.time.timezone, 'string')
})

test('buildPrimer: jina/network null passthrough', () => {
  const d = buildPrimer({ now: new Date(), jina: null, network: null })
  assert.equal(d.jina, null)
  assert.equal(d.network, null)
})

test('buildPrimer: full data passthrough', () => {
  const now = new Date()
  const jina = { authenticatedAs: 'acct-1', balanceLeft: 42 }
  const network = { ip: '9.9.9.9', city: 'X', region: 'Y', country: 'ZZ', org: 'AS1', timezone: 'UTC', loc: '0,0' }
  const d = buildPrimer({ now, jina, network })
  assert.deepEqual(d.jina, jina)
  assert.deepEqual(d.network, network)
})

test('formatPrimer: text rendering includes all sections', () => {
  const now = new Date('2026-08-16T10:23:45+08:00')
  const data = buildPrimer({
    now,
    jina: { authenticatedAs: 'acct-0d821283 (auto-key)', balanceLeft: 8522479 },
    network: parseIpInfo(IPINFO_FIXTURE),
  })
  const text = formatPrimer(data)
  assert.match(text, /^Time: /)
  assert.match(text, /Network: 1\.2\.3\.4/)
  assert.match(text, /Jina: authenticated as acct-0d821283/)
  assert.match(text, /8,522,479/)
})

test('formatPrimer: text rendering with unavailable sections never prints undefined', () => {
  const now = new Date('2026-08-16T10:23:45+08:00')
  const text = formatPrimer(buildPrimer({ now, jina: null, network: null }))
  assert.match(text, /Network: unavailable/)
  assert.match(text, /Jina: unavailable/)
  assert.ok(!text.includes('undefined'), 'output must not contain the literal undefined: ' + text)
})

test('formatPrimer: json rendering round-trips the data object', () => {
  const now = new Date('2026-08-16T10:23:45+08:00')
  const data = buildPrimer({ now, jina: { authenticatedAs: 'a', balanceLeft: 1 }, network: parseIpInfo(IPINFO_FIXTURE) })
  const parsed = JSON.parse(formatPrimer(data, true))
  assert.deepEqual(parsed, data)
})

test('smoke: index.js still exports the plugin apply function', async () => {
  const mod = await import('../index.js')
  assert.equal(typeof mod.apply, 'function')
})

test('formatUtcOffset: renders whole hours compactly', () => {
  assert.equal(formatUtcOffset(480), 'UTC+8')
  assert.equal(formatUtcOffset(-480), 'UTC-8')
  assert.equal(formatUtcOffset(0), 'UTC±0')
})

test('formatUtcOffset: renders fractional hours with minutes', () => {
  assert.equal(formatUtcOffset(-330), 'UTC-5h 30m')
  assert.equal(formatUtcOffset(345), 'UTC+5h 45m')
})

test('formatPrimer: time line uses hour-based offset', () => {
  const now = new Date('2026-08-16T10:23:45Z')
  const d = buildPrimer({ now, jina: null, network: null })
  const text = formatPrimer(d)
  const off = formatUtcOffset(d.time.utcOffsetMinutes)
  assert.ok(text.includes('(' + d.time.timezone + ', ' + off + ')'), text)
})
