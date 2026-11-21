import { z } from 'zod'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { completeOnboarding, probeToolchain, readOnboarding } from '../../runtime-onboarding'

/** 首次启动的运行环境引导：读状态、做体检、记下选择。 */
export function registerRuntimeOnboardingHandlers(): void {
  registerHandler('ipc:runtime.onboarding.get', async () => readOnboarding())
  registerHandler('ipc:runtime.probe', async () => probeToolchain())
  registerHandlerWithSchema(
    'ipc:runtime.onboarding.complete',
    z.object({ mode: z.enum(['builtin', 'global']) }).strict(),
    async (req) => completeOnboarding(req.mode),
  )
}
