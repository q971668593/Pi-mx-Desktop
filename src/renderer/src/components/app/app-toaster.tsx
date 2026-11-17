import { Toaster } from 'sonner'
import './app-toaster.css'

/** 全局唯一 Sonner 实例，避免重复挂载导致重复提示音 */
export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      className="app-toaster"
      visibleToasts={2}
      expand={false}
      offset={{ bottom: 38, right: 16 }}
      toastOptions={{ duration: 2200, className: 'app-toast' }}
    />
  )
}
