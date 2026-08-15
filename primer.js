/**
 * dsh-jina — pure helpers for the jina_primer tool.
 *
 * Kept free of any Cordis / ctx / network dependency so the behavior is
 * unit-testable without a running harness (see test/primer.test.js).
 *
 * Data sources (both best-effort, resolved by the tool executor):
 *   - Jina account status: GET https://r.jina.ai/ (Accept: application/json)
 *   - Network facts:       GET https://ipinfo.io/json (free, no key)
 *   - Time facts:          host clock at call time
 */

/** Parse the r.jina.ai root JSON into { authenticatedAs, balanceLeft }. */
export function parseJinaRoot(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const d = parsed.data
  if (!d || typeof d !== 'object') return null
  return {
    authenticatedAs: typeof d.authenticatedAs === 'string' && d.authenticatedAs !== '' ? d.authenticatedAs : null,
    balanceLeft: typeof d.balanceLeft === 'number' && Number.isFinite(d.balanceLeft) ? d.balanceLeft : null,
  }
}

/** Parse an ipinfo.io payload into { ip, city, region, country, org, timezone, loc }. */
export function parseIpInfo(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.ip !== 'string' || parsed.ip === '') return null
  const pick = (k) => (typeof parsed[k] === 'string' && parsed[k] !== '' ? parsed[k] : null)
  return {
    ip: parsed.ip,
    city: pick('city'),
    region: pick('region'),
    country: pick('country'),
    org: pick('org'),
    timezone: pick('timezone'),
    loc: pick('loc'),
  }
}

/** Render a UTC offset in minutes as a compact label (UTC+8, UTC-5h 30m, UTC±0). */
export function formatUtcOffset(minutes) {
  const off = Number(minutes)
  if (!Number.isFinite(off)) return ''
  if (off === 0) return 'UTC±0'
  const sign = off > 0 ? '+' : '-'
  const abs = Math.abs(off)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  if (m === 0) return 'UTC' + sign + h
  return 'UTC' + sign + h + 'h ' + m + 'm'
}

/** Compose the primer data object from the given clock and optional sections. */
export function buildPrimer({ now, jina, network }) {
  const t = now instanceof Date ? now : new Date(now)
  let timezone = null
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    timezone = null
  }
  return {
    time: {
      iso: t.toISOString(),
      unix: Math.floor(t.getTime() / 1000),
      timezone,
      utcOffsetMinutes: -t.getTimezoneOffset(),
    },
    jina: jina === undefined ? null : jina,
    network: network === undefined ? null : network,
  }
}

/** Render the primer data object as human-readable text (default) or JSON. */
export function formatPrimer(data, asJson = false) {
  if (asJson) return JSON.stringify(data, null, 2)
  const lines = []
  const t = data && data.time
  if (t) {
    const offStr = formatUtcOffset(t.utcOffsetMinutes)
    const tz = t.timezone ? ' (' + t.timezone + ', ' + offStr + ')' : ''
    const unix = typeof t.unix === 'number' ? ' | unix ' + t.unix : ''
    lines.push('Time: ' + String(t.iso) + tz + unix)
  }
  const n = data && data.network
  if (n) {
    const parts = [n.ip]
    const geo = [n.city, n.region, n.country].filter(Boolean).join(', ')
    if (geo) parts.push(geo)
    if (n.org) parts.push(n.org)
    if (n.timezone) parts.push('tz ' + n.timezone)
    lines.push('Network: ' + parts.join(' — '))
  } else {
    lines.push('Network: unavailable')
  }
  const j = data && data.jina
  if (j) {
    const bal =
      typeof j.balanceLeft === 'number'
        ? 'balance ' + j.balanceLeft.toLocaleString('en-US') + ' credits'
        : 'balance unknown'
    const who = j.authenticatedAs ? 'authenticated as ' + j.authenticatedAs : 'anonymous quota'
    lines.push('Jina: ' + who + ' (' + bal + ')')
  } else {
    lines.push('Jina: unavailable (no response from r.jina.ai)')
  }
  return lines.join('\n')
}
