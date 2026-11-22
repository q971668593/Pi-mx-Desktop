import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { ProviderConfigDialog } from './provider-config-dialog'
import { PROVIDER_PRESETS } from './model-provider-presets'

beforeAll(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
})

const openaiPreset = PROVIDER_PRESETS.find((preset) => preset.id === 'openai')!

function renderAdd(onSubmit = vi.fn(), onCancel = vi.fn()) {
  render(
    <ProviderConfigDialog
      mode="add"
      pid="openai"
      preset={openaiPreset}
      initial={{ ...openaiPreset.config }}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  )
  return { onSubmit, onCancel }
}

describe('ProviderConfigDialog', () => {
  it('prefills the template fields and saves them verbatim', () => {
    const { onSubmit } = renderAdd()

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByLabelText(/Name/i)).toHaveValue('OpenAI')
    expect(screen.getByLabelText(/Base URL/i)).toHaveValue('https://api.openai.com/v1')

    fireEvent.change(screen.getByLabelText(/Base URL/i), { target: { value: 'https://relay.example.com/v1' } })
    fireEvent.click(screen.getByRole('button', { name: /Save and add/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      pid: 'openai',
      config: { name: 'OpenAI', baseUrl: 'https://relay.example.com/v1', api: 'openai-completions' },
    })
  })

  it('refuses to save without a name', () => {
    const { onSubmit } = renderAdd()

    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /Save and add/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/name is required/i)).toBeTruthy()
  })

  it('accepts a scheme-less gateway url and normalises it to http', () => {
    const { onSubmit } = renderAdd()

    fireEvent.change(screen.getByLabelText(/Base URL/i), { target: { value: 'localhost:11434/v1' } })
    fireEvent.click(screen.getByRole('button', { name: /Save and add/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      config: { baseUrl: 'http://localhost:11434/v1' },
    })
  })

  it('refuses an empty base url', () => {
    const { onSubmit } = renderAdd()

    fireEvent.change(screen.getByLabelText(/Base URL/i), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /Save and add/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/Endpoint is required/i)).toBeTruthy()
  })

  it('edits an existing provider and keeps fields the dialog does not own', () => {
    const onSubmit = vi.fn()
    render(
      <ProviderConfigDialog
        mode="edit"
        pid="custom"
        initial={{
          name: 'Custom',
          baseUrl: 'https://example.invalid/v1',
          api: 'openai-completions',
          models: [{ id: 'model-a' }],
          modelOverrides: { 'model-a': { contextWindow: 64000 } },
        }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText(/Base URL/i), { target: { value: 'https://example.invalid/v2' } })
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }))

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      pid: 'custom',
      config: {
        name: 'Custom',
        baseUrl: 'https://example.invalid/v2',
        models: [{ id: 'model-a' }],
        modelOverrides: { 'model-a': { contextWindow: 64000 } },
      },
    })
  })

  it('cancels with Escape', () => {
    const { onCancel } = renderAdd()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
