export type SettingsRouteTarget = {
  page?: string
  tab?: string
}

let pendingRoute: SettingsRouteTarget | null = null

export const OPEN_SETTINGS_PAGE_EVENT = 'pi-desktop:open-settings-page'

export function openSettingsPage(target: SettingsRouteTarget = {}): void {
  pendingRoute = target
  window.dispatchEvent(new CustomEvent<SettingsRouteTarget>(OPEN_SETTINGS_PAGE_EVENT, { detail: target }))
}

export function consumePendingSettingsRoute(): SettingsRouteTarget | null {
  const next = pendingRoute
  pendingRoute = null
  return next
}
