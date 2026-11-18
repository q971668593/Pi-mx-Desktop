/**
 * Single definition of "a web URL the app may hand to the OS shell or open in a tab".
 *
 * Both the link-preview handler and the window navigation guard call this, so tightening
 * the policy (for example rejecting credentials or extra protocols) happens once.
 * http(s) only: `file:`, `javascript:`, `data:` and custom protocols must never reach
 * `shell.openExternal` / `shell.openPath`.
 */
export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}
