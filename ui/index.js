/**
 * dsh-jina/ui — host half of the dual-face client package.
 *
 * The browser bundle lives in ./client.js (declared through
 * `exports["./client"]` in ./package.json, discovered by the host
 * client-modules service). This host half exists so the composition row
 * `dsh-jina/ui` is a valid, immediately-active loader entry; it contributes
 * nothing itself.
 */
export const name = 'dsh-jina-ui'

export const inject = []

export function apply() {
}
