import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { FilePickerInput } from '@/components/file-picker-input'
import { fireEvent, render, screen } from '@/test/test-utils'

function FilePickerHarness({
  onFilesSelected,
}: {
  onFilesSelected: (files: File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [resumed, setResumed] = useState(false)

  return (
    <>
      <FilePickerInput
        ref={inputRef}
        className="hidden"
        onFilesSelected={onFilesSelected}
      />
      <button type="button" onClick={() => inputRef.current?.click()}>
        Choose file
      </button>
      <button type="button" onClick={() => setResumed(true)}>
        Resume app
      </button>
      <output>{resumed ? 'resumed' : 'active'}</output>
    </>
  )
}

describe('FilePickerInput', () => {
  it('keeps the active native input mounted when the app rerenders after the picker', () => {
    const { container } = render(
      <FilePickerHarness onFilesSelected={vi.fn()} />,
    )
    const selectedInput =
      container.querySelector<HTMLInputElement>('input[type="file"]')!
    const clickSpy = vi.spyOn(selectedInput, 'click')

    fireEvent.click(screen.getByRole('button', { name: 'Choose file' }))
    expect(clickSpy).toHaveBeenCalledOnce()

    // Android can resume the PWA before Chrome delivers the delayed change.
    fireEvent.click(screen.getByRole('button', { name: 'Resume app' }))

    expect(screen.getByText('resumed')).toBeInTheDocument()
    expect(container.querySelector('input[type="file"]')).toBe(selectedInput)
    expect(document.body.contains(selectedInput)).toBe(true)
  })

  it('delivers every selected file and clears the input for reselection', () => {
    const onFilesSelected = vi.fn()
    const { container } = render(
      <FilePickerHarness onFilesSelected={onFilesSelected} />,
    )
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!
    const files = [
      new File(['one'], 'one.jpg', { type: 'image/jpeg' }),
      new File(['two'], 'two.pdf', { type: 'application/pdf' }),
    ]

    fireEvent.change(input, { target: { files } })

    expect(onFilesSelected).toHaveBeenCalledWith(files)
    expect(input.value).toBe('')

    fireEvent.change(input, { target: { files } })
    expect(onFilesSelected).toHaveBeenCalledTimes(2)
  })

  it('treats an empty picker result as cancellation', () => {
    const onFilesSelected = vi.fn()
    const { container } = render(
      <FilePickerHarness onFilesSelected={onFilesSelected} />,
    )
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!

    fireEvent.change(input, { target: { files: [] } })

    expect(onFilesSelected).not.toHaveBeenCalled()
    expect(input.value).toBe('')
  })
})
