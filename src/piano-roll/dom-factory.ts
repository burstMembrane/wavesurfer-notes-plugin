import type { PreviewSynthType } from './synth-manager'

/**
 * Common button styles
 */
const BUTTON_STYLES = {
    padding: '4px 8px',
    fontSize: '11px',
    fontWeight: '500',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: '#fff',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
} as const

/**
 * Common select styles
 */
const SELECT_STYLES = {
    padding: '4px 6px',
    fontSize: '11px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: '#fff',
    cursor: 'pointer',
} as const

/**
 * Apply styles to an element
 */
function applyStyles(element: HTMLElement, styles: Record<string, string>): void {
    Object.assign(element.style, styles)
}

/**
 * Create a styled button with hover effects
 */
export function createButton(
    text: string,
    title: string,
    onClick: (e: MouseEvent) => void,
    getActiveState?: () => boolean
): HTMLButtonElement {
    const button = document.createElement('button')
    button.textContent = text
    button.title = title
    applyStyles(button, BUTTON_STYLES)

    button.addEventListener('click', (e) => {
        e.stopPropagation()
        e.preventDefault()
        onClick(e)
    })

    button.addEventListener('mouseenter', () => {
        const isActive = getActiveState?.() ?? false
        button.style.backgroundColor = isActive ? '#5ee0b4' : '#444'
    })

    button.addEventListener('mouseleave', () => {
        const isActive = getActiveState?.() ?? false
        button.style.backgroundColor = isActive ? '#4ecca3' : '#333'
    })

    return button
}

/**
 * Create the fold button
 */
export function createFoldButton(
    onClick: () => void,
    getIsFolded: () => boolean
): HTMLButtonElement {
    const button = createButton(
        'Fold',
        'Toggle fold view',
        onClick,
        getIsFolded
    )
    return button
}

/**
 * Update fold button appearance
 */
export function updateFoldButton(button: HTMLButtonElement, isFolded: boolean): void {
    button.textContent = isFolded ? 'Unfold' : 'Fold'
    button.style.backgroundColor = isFolded ? '#4ecca3' : '#333'
}

/**
 * Create the preview button
 */
export function createPreviewButton(
    onClick: () => void,
    getIsEnabled: () => boolean
): HTMLButtonElement {
    const button = document.createElement('button')
    button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></svg>'
    button.title = 'Preview MIDI notes'
    applyStyles(button, BUTTON_STYLES)

    button.addEventListener('click', (e) => {
        e.stopPropagation()
        e.preventDefault()
        onClick()
    })

    button.addEventListener('mouseenter', () => {
        button.style.backgroundColor = getIsEnabled() ? '#5ee0b4' : '#444'
    })

    button.addEventListener('mouseleave', () => {
        button.style.backgroundColor = getIsEnabled() ? '#4ecca3' : '#333'
    })

    return button
}

/**
 * Update preview button appearance
 */
export function updatePreviewButton(button: HTMLButtonElement, enabled: boolean): void {
    button.style.backgroundColor = enabled ? '#4ecca3' : '#333'
}

/**
 * Create synth type selector
 */
export function createSynthTypeSelect(
    onChange: (type: PreviewSynthType) => void,
    initialValue: PreviewSynthType = 'synth'
): HTMLSelectElement {
    const select = document.createElement('select')
    select.title = 'Select synth type'
    applyStyles(select, SELECT_STYLES)

    select.innerHTML = `
        <option value="sine" ${initialValue === 'sine' ? 'selected' : ''}>Sine</option>
        <option value="synth" ${initialValue === 'synth' ? 'selected' : ''}>Synth</option>
        <option value="piano" ${initialValue === 'piano' ? 'selected' : ''}>Piano</option>
    `

    select.addEventListener('change', (e) => {
        e.stopPropagation()
        onChange((e.target as HTMLSelectElement).value as PreviewSynthType)
    })

    select.addEventListener('click', (e) => e.stopPropagation())

    return select
}

/**
 * Create FFT size selector
 */
export function createFftSelect(
    onChange: (size: number) => void,
    initialValue: number = 1024
): HTMLSelectElement {
    const select = document.createElement('select')
    select.title = 'FFT size for spectrogram'
    applyStyles(select, SELECT_STYLES)

    const fftSizes = [256, 512, 1024, 2048, 4096, 8192]
    select.innerHTML = fftSizes.map(size =>
        `<option value="${size}" ${size === initialValue ? 'selected' : ''}>FFT ${size}</option>`
    ).join('')

    select.addEventListener('change', (e) => {
        e.stopPropagation()
        const size = parseInt((e.target as HTMLSelectElement).value, 10)
        onChange(size)
    })

    select.addEventListener('click', (e) => e.stopPropagation())

    return select
}

/**
 * Create snap to spectrogram checkbox
 */
export function createSnapCheckbox(
    onChange: (enabled: boolean) => void,
    initialValue: boolean = false
): HTMLLabelElement {
    const label = document.createElement('label')
    label.style.display = 'flex'
    label.style.alignItems = 'center'
    label.style.gap = '4px'
    label.style.padding = '4px 8px'
    label.style.fontSize = '11px'
    label.style.color = '#fff'
    label.style.cursor = 'pointer'
    label.style.backgroundColor = '#333'
    label.style.borderRadius = '4px'
    label.title = 'Double-click snaps to bright spectrogram regions'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = initialValue
    checkbox.style.cursor = 'pointer'

    checkbox.addEventListener('change', (e) => {
        e.stopPropagation()
        onChange((e.target as HTMLInputElement).checked)
    })

    checkbox.addEventListener('click', (e) => e.stopPropagation())

    const text = document.createElement('span')
    text.textContent = 'Snap'

    label.appendChild(checkbox)
    label.appendChild(text)
    label.addEventListener('click', (e) => e.stopPropagation())

    return label
}

/**
 * Create export button (MIDI or JSON)
 */
export function createExportButton(
    text: string,
    title: string,
    onClick: () => void
): HTMLButtonElement {
    const button = document.createElement('button')
    button.textContent = text
    button.title = title
    applyStyles(button, BUTTON_STYLES)

    button.addEventListener('click', (e) => {
        e.stopPropagation()
        e.preventDefault()
        onClick()
    })

    button.addEventListener('mouseenter', () => {
        button.style.backgroundColor = '#444'
    })

    button.addEventListener('mouseleave', () => {
        button.style.backgroundColor = '#333'
    })

    return button
}

/**
 * Create the controls container
 */
export function createControlsContainer(): HTMLDivElement {
    const container = document.createElement('div')
    container.style.display = 'flex'
    container.style.gap = '4px'
    container.style.pointerEvents = 'auto'

    // Prevent clicks on controls from triggering canvas events
    container.addEventListener('mousedown', (e) => e.stopPropagation())
    container.addEventListener('dblclick', (e) => e.stopPropagation())

    return container
}

/**
 * Create the tooltip element
 */
export function createTooltip(): HTMLDivElement {
    const tooltip = document.createElement('div')
    tooltip.style.position = 'absolute'
    tooltip.style.padding = '4px 8px'
    tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.85)'
    tooltip.style.color = '#fff'
    tooltip.style.fontSize = '12px'
    tooltip.style.fontFamily = 'monospace'
    tooltip.style.borderRadius = '4px'
    tooltip.style.pointerEvents = 'none'
    tooltip.style.zIndex = '60'
    tooltip.style.display = 'none'
    tooltip.style.whiteSpace = 'nowrap'
    return tooltip
}

/**
 * Create the main container element
 */
export function createMainContainer(height: number, backgroundColor: string): HTMLDivElement {
    const container = document.createElement('div')
    container.style.position = 'relative'
    container.style.height = `${height}px`
    container.style.overflow = 'hidden'
    container.style.backgroundColor = backgroundColor
    return container
}

/**
 * Create a canvas element
 */
export function createCanvas(
    zIndex: string,
    pointerEvents: 'auto' | 'none' = 'auto'
): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.style.position = 'absolute'
    canvas.style.top = '0'
    canvas.style.left = '0'
    canvas.style.zIndex = zIndex
    if (pointerEvents === 'none') {
        canvas.style.pointerEvents = 'none'
    }
    return canvas
}

/**
 * Create the playhead element
 */
export function createPlayhead(color: string, width: number): HTMLDivElement {
    const playhead = document.createElement('div')
    playhead.style.position = 'absolute'
    playhead.style.top = '0'
    playhead.style.width = `${width}px`
    playhead.style.height = '100%'
    playhead.style.backgroundColor = color
    playhead.style.boxShadow = `0 0 10px ${color}`
    playhead.style.pointerEvents = 'none'
    playhead.style.zIndex = '40'
    playhead.style.left = '0'
    return playhead
}

/**
 * Create keyboard canvas with fixed width
 */
export function createKeyboardCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.style.position = 'absolute'
    canvas.style.top = '0'
    canvas.style.left = '0'
    canvas.style.zIndex = '30'
    canvas.style.pointerEvents = 'none'
    return canvas
}
