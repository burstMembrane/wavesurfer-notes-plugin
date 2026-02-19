import type WaveSurfer from 'wavesurfer.js'
import { BasePlugin } from 'wavesurfer.js/dist/base-plugin.js'
import { Midi } from '@tonejs/midi'

import type {
    PianoRollPluginEvents,
    PianoRollPluginOptions,
    PianoRollNote,
    PianoRollNoteInput,
    CSVParseOptions,
} from './piano-roll/types'
import { DEFAULT_COLOR_PALETTE } from './piano-roll/types'
import {
    pitchToNoteName,
    toMidiPitch,
    clampPitch,
    midiToHz,
} from './piano-roll/note-utils'
import {
    calculateSpectrogram,
    type ColorMapType,
} from './piano-roll/spectrogram'
import { SynthManager, type PreviewSynthType } from './piano-roll/synth-manager'
import {
    type CoordinateParams,
    createCoordinateParams,
    getNoteHeight,
    timeToPx,
    pxToTime,
    pitchToPx,
    pxToPitch,
} from './piano-roll/coordinates'
import type { NoteColorOptions } from './piano-roll/note-color'
import {
    renderGrid,
    renderNotes,
    renderKeyboard,
    renderSpectrogram,
    type NoteRenderState,
    type RenderOptions,
} from './piano-roll/rendering'
import {
    createMainContainer,
    createCanvas,
    createPlayhead,
    createKeyboardCanvas,
    createControlsContainer,
    createTooltip,
    createFoldButton,
    createPreviewButton,
    createSynthTypeSelect,
    createFftSelect,
    createSnapCheckbox,
    createExportButton,
    updateFoldButton,
    updatePreviewButton,
} from './piano-roll/dom-factory'

// Re-export types
export type {
    PianoRollPluginEvents,
    PianoRollPluginOptions,
    PianoRollNote,
    PianoRollNoteInput,
    CSVParseOptions,
}
export type { PreviewSynthType }

/**
 * WaveSurfer plugin that displays a piano roll visualization below the waveform.
 * Supports MIDI files, CSV (vocadito-style with Hz), and JSON note data.
 *
 * @example
 * ```ts
 * const pianoRoll = PianoRollPlugin.create({
 *   height: 200,
 *   showKeyboard: true,
 *   colorMode: 'velocity'
 * })
 * wavesurfer.registerPlugin(pianoRoll)
 *
 * // Load MIDI file
 * await pianoRoll.loadMidi('/path/to/file.mid')
 *
 * // Or load CSV (vocadito format with Hz frequencies)
 * const csv = await fetch('/vocadito/notes.csv').then(r => r.text())
 * pianoRoll.loadCSV(csv, { pitchIsHz: true })
 * ```
 */
export default class PianoRollPlugin extends BasePlugin<PianoRollPluginEvents, PianoRollPluginOptions> {
    protected subscriptions: (() => void)[] = []

    // DOM Elements
    private container: HTMLElement | null = null
    private canvas: HTMLCanvasElement | null = null
    private ctx: CanvasRenderingContext2D | null = null
    private keyboardCanvas: HTMLCanvasElement | null = null
    private keyboardCtx: CanvasRenderingContext2D | null = null
    private playhead: HTMLElement | null = null
    private controlsContainer: HTMLElement | null = null
    private foldButton: HTMLButtonElement | null = null
    private tooltip: HTMLElement | null = null
    private spectrogramCanvas: HTMLCanvasElement | null = null
    private spectrogramCtx: CanvasRenderingContext2D | null = null
    private previewButton: HTMLButtonElement | null = null

    // Hover state
    private hoveredNote: PianoRollNote | null = null

    // Spectrogram data
    private spectrogramData: Float32Array[] = []
    private audioSampleRate = 44100

    // Data
    private notes: PianoRollNote[] = []
    private minPitch = 21 // A0
    private maxPitch = 108 // C8
    private trackCount = 0

    // Fold state
    private isFolded = false
    private usedPitches: number[] = []

    // Playback state
    private currentTime = 0
    private activeNotes: Set<PianoRollNote> = new Set()

    // Synth manager
    private synthManager = new SynthManager()

    // Snap to spectrogram state
    private snapEnabled = false

    // Drag state for note editing
    private dragState: {
        note: PianoRollNote
        originalNote: PianoRollNote
        mode: 'move' | 'resize-left' | 'resize-right'
        startX: number
        startY: number
        offsetX: number
        offsetY: number
        lastPreviewPitch: number
        multiDrag?: {
            notes: PianoRollNote[]
            originals: PianoRollNote[]
        }
    } | null = null
    private readonly EDGE_THRESHOLD = 8
    private readonly MIN_NOTE_DURATION = 0.05

    // FFT size for spectrogram
    private currentFftSize: number = 1024
    private cachedAudioBuffer: AudioBuffer | null = null

    // Selection state
    private selectedNotes: Set<PianoRollNote> = new Set()
    private selectionBox: {
        startX: number
        startY: number
        endX: number
        endY: number
        active: boolean
    } | null = null

    constructor(options: PianoRollPluginOptions = {}) {
        super(options)
    }

    public static create(options?: PianoRollPluginOptions): PianoRollPlugin {
        return new PianoRollPlugin(options || {})
    }

    private getOptions(): Required<PianoRollPluginOptions> {
        return {
            height: this.options.height ?? 200,
            minPitch: this.options.minPitch ?? 21,
            maxPitch: this.options.maxPitch ?? 108,
            showKeyboard: this.options.showKeyboard ?? true,
            keyboardWidth: this.options.keyboardWidth ?? 50,
            colorMode: this.options.colorMode ?? 'velocity',
            noteColor: this.options.noteColor ?? '#4a90d9',
            colorPalette: this.options.colorPalette ?? DEFAULT_COLOR_PALETTE,
            noteBorderColor: this.options.noteBorderColor ?? 'rgba(0,0,0,0.3)',
            noteBorderWidth: this.options.noteBorderWidth ?? 1,
            noteRadius: this.options.noteRadius ?? 2,
            backgroundColor: this.options.backgroundColor ?? '#1a1a2e',
            showGrid: this.options.showGrid ?? true,
            gridColor: this.options.gridColor ?? 'rgba(128,128,128,0.2)',
            playheadColor: this.options.playheadColor ?? '#e94560',
            playheadWidth: this.options.playheadWidth ?? 2,
            activeNoteColor: this.options.activeNoteColor ?? '#ffffff',
            activeNoteGlow: this.options.activeNoteGlow ?? true,
            showFoldButton: this.options.showFoldButton ?? true,
            foldedByDefault: this.options.foldedByDefault ?? false,
            showSpectrogram: this.options.showSpectrogram ?? false,
            fftSamples: this.options.fftSamples ?? 1024,
            frequencyMin: this.options.frequencyMin ?? 20,
            frequencyMax: this.options.frequencyMax ?? 20000,
            spectrogramOpacity: this.options.spectrogramOpacity ?? 0.7,
            spectrogramColorMap: this.options.spectrogramColorMap ?? 'default',
            spectrogramOverlap: this.options.spectrogramOverlap ?? 0.75,
            snapToSpectrogram: this.options.snapToSpectrogram ?? false,
        }
    }

    // ==================== Coordinate Helpers ====================

    private getCoordinateParams(): CoordinateParams {
        const wrapper = this.wavesurfer?.getWrapper()
        const width = wrapper?.scrollWidth ?? 0
        const height = this.getOptions().height
        const duration = this.wavesurfer?.getDuration() ?? 0

        return createCoordinateParams(
            width,
            height,
            duration,
            this.minPitch,
            this.maxPitch,
            this.isFolded,
            this.usedPitches
        )
    }

    private timeToPx(time: number): number {
        return timeToPx(time, this.getCoordinateParams())
    }

    public pxToTime(px: number): number {
        return pxToTime(px, this.getCoordinateParams())
    }

    private pitchToPx(pitch: number): number {
        return pitchToPx(pitch, this.getCoordinateParams())
    }

    private pxToPitch(y: number): number {
        return pxToPitch(y, this.getCoordinateParams())
    }

    private getNoteHeight(): number {
        return getNoteHeight(this.getCoordinateParams())
    }

    // ==================== State Management ====================

    private updateUsedPitches(): void {
        const pitchSet = new Set<number>()
        for (const note of this.notes) {
            pitchSet.add(note.pitch)
        }
        this.usedPitches = Array.from(pitchSet).sort((a, b) => a - b)
    }

    public toggleFold(): void {
        this.isFolded = !this.isFolded
        if (this.foldButton) updateFoldButton(this.foldButton, this.isFolded)
        this.render()
    }

    public setFftSize(size: number): void {
        const validSizes = [256, 512, 1024, 2048, 4096, 8192]
        if (!validSizes.includes(size)) {
            console.warn(`Invalid FFT size ${size}, must be one of: ${validSizes.join(', ')}`)
            return
        }
        this.currentFftSize = size
        if (this.cachedAudioBuffer) {
            this.calculateSpectrogramData(this.cachedAudioBuffer)
        }
    }

    public setFolded(folded: boolean): void {
        this.isFolded = folded
        if (this.foldButton) updateFoldButton(this.foldButton, this.isFolded)
        this.render()
    }

    // ==================== Preview Controls ====================

    public async togglePreview(): Promise<void> {
        await this.synthManager.togglePreview()
        if (this.previewButton) updatePreviewButton(this.previewButton, this.synthManager.enabled)
    }

    public async setSynthType(type: PreviewSynthType): Promise<void> {
        await this.synthManager.setSynthType(type)
    }

    // ==================== Color Helpers ====================

    private getNoteColorOptions(): NoteColorOptions {
        const opts = this.getOptions()
        return {
            colorMode: opts.colorMode,
            noteColor: opts.noteColor,
            colorPalette: opts.colorPalette,
        }
    }

    // ==================== DOM Creation ====================

    private createElements(): void {
        if (!this.wavesurfer) return

        const opts = this.getOptions()
        const wavesurferWrapper = this.wavesurfer.getWrapper()

        this.currentFftSize = opts.fftSamples

        // Create main container
        this.container = createMainContainer(opts.height, opts.backgroundColor)

        // Create spectrogram canvas (background layer)
        if (opts.showSpectrogram) {
            this.spectrogramCanvas = createCanvas('1')
            this.spectrogramCanvas.style.opacity = String(opts.spectrogramOpacity)
            this.container.appendChild(this.spectrogramCanvas)
            this.spectrogramCtx = this.spectrogramCanvas.getContext('2d')
        }

        // Create notes canvas
        this.canvas = createCanvas('2')
        this.container.appendChild(this.canvas)

        // Create playhead
        this.playhead = createPlayhead(opts.playheadColor, opts.playheadWidth)
        this.container.appendChild(this.playhead)

        // Create keyboard canvas
        if (opts.showKeyboard) {
            this.keyboardCanvas = createKeyboardCanvas(opts.keyboardWidth, opts.height)
            this.container.appendChild(this.keyboardCanvas)
            this.keyboardCtx = this.keyboardCanvas.getContext('2d')
        }

        this.ctx = this.canvas.getContext('2d')

        // Create controls
        if (opts.showFoldButton) {
            this.controlsContainer = createControlsContainer()

            // Fold button
            this.foldButton = createFoldButton(
                () => this.toggleFold(),
                () => this.isFolded
            )
            this.controlsContainer.appendChild(this.foldButton)

            // Preview button
            this.previewButton = createPreviewButton(
                () => this.togglePreview(),
                () => this.synthManager.enabled
            )
            this.controlsContainer.appendChild(this.previewButton)

            // Synth type selector
            const synthSelect = createSynthTypeSelect(
                (type) => this.setSynthType(type),
                'synth'
            )
            this.controlsContainer.appendChild(synthSelect)

            // Export buttons
            const exportMidiBtn = createExportButton('MIDI', 'Export notes as MIDI file', () => this.exportMidi())
            this.controlsContainer.appendChild(exportMidiBtn)

            const exportJsonBtn = createExportButton('JSON', 'Export notes as JSON file', () => this.exportJSON())
            this.controlsContainer.appendChild(exportJsonBtn)

            // FFT size selector (if spectrogram enabled)
            if (opts.showSpectrogram) {
                const fftSelect = createFftSelect(
                    (size) => this.setFftSize(size),
                    this.currentFftSize
                )
                this.controlsContainer.appendChild(fftSelect)

                // Snap checkbox
                const snapLabel = createSnapCheckbox(
                    (enabled) => { this.snapEnabled = enabled },
                    opts.snapToSpectrogram
                )
                this.snapEnabled = opts.snapToSpectrogram
                this.controlsContainer.appendChild(snapLabel)
            }
        }

        // Create tooltip
        this.tooltip = createTooltip()
        this.container.appendChild(this.tooltip)

        // Add event listeners
        this.container.addEventListener('mousemove', this.onMouseMove)
        this.container.addEventListener('mouseleave', this.onMouseLeave)
        this.container.addEventListener('mousedown', this.onMouseDown)
        this.container.addEventListener('dblclick', this.onDoubleClick)

        wavesurferWrapper.appendChild(this.container)

        // Append controls to the user container in the regular DOM.
        // WaveSurfer v7 uses Shadow DOM: getWrapper() returns .wrapper inside the shadow root.
        // parentElement traversal stops at the shadow root boundary (returns null there),
        // so we escape via getRootNode().host to reach the actual user-provided container.
        if (this.controlsContainer) {
            const rootNode = wavesurferWrapper.getRootNode()
            const shadowHost = rootNode instanceof ShadowRoot ? (rootNode.host as HTMLElement) : null
            const userContainer = shadowHost?.parentElement as HTMLElement | null

            const applyControlsStyles = (parent: HTMLElement) => {
                parent.style.position = 'relative'
                this.controlsContainer!.style.position = 'absolute'
                this.controlsContainer!.style.top = '4px'
                this.controlsContainer!.style.right = '4px'
                this.controlsContainer!.style.zIndex = '100'
                parent.appendChild(this.controlsContainer!)
            }

            if (userContainer) {
                // Best case: attach to the user-provided wavesurfer container (regular DOM).
                // This element's width is governed by page layout and never grows with zoom,
                // so right: 4px stays pinned to the visible right edge.
                applyControlsStyles(userContainer)
            } else if (shadowHost) {
                // Fallback: attach to shadow host div (still in regular DOM, fixed width)
                applyControlsStyles(shadowHost)
            } else {
                // Final fallback: attach to .scroll inside shadow DOM
                const scrollContainer = wavesurferWrapper.parentElement
                if (scrollContainer) {
                    applyControlsStyles(scrollContainer as HTMLElement)
                } else {
                    applyControlsStyles(this.container)
                }
            }
        }

        // Initialize fold state
        this.isFolded = opts.foldedByDefault
        if (this.foldButton) updateFoldButton(this.foldButton, this.isFolded)
    }

    // ==================== Rendering ====================

    private resizeCanvas(): void {
        if (!this.canvas || !this.wavesurfer || !this.ctx) return

        const opts = this.getOptions()
        const wrapper = this.wavesurfer.getWrapper()
        const dpr = window.devicePixelRatio || 1

        const displayWidth = wrapper.scrollWidth
        const displayHeight = opts.height

        this.canvas.width = displayWidth * dpr
        this.canvas.height = displayHeight * dpr
        this.canvas.style.width = `${displayWidth}px`
        this.canvas.style.height = `${displayHeight}px`
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        if (this.spectrogramCanvas) {
            this.spectrogramCanvas.width = displayWidth
            this.spectrogramCanvas.height = displayHeight
            this.spectrogramCanvas.style.width = `${displayWidth}px`
            this.spectrogramCanvas.style.height = `${displayHeight}px`
        }
    }

    private render(): void {
        this.resizeCanvas()
        this.renderSpectrogramLayer()
        this.renderGridLayer()
        this.renderNotesLayer()
        this.renderKeyboardLayer()
    }

    private getRenderOptions(): RenderOptions {
        const opts = this.getOptions()
        return {
            backgroundColor: opts.backgroundColor,
            showGrid: opts.showGrid,
            gridColor: opts.gridColor,
            showSpectrogram: opts.showSpectrogram,
            noteBorderColor: opts.noteBorderColor,
            noteBorderWidth: opts.noteBorderWidth,
            noteRadius: opts.noteRadius,
            activeNoteColor: opts.activeNoteColor,
            activeNoteGlow: opts.activeNoteGlow,
            playheadColor: opts.playheadColor,
        }
    }

    private getNoteRenderState(): NoteRenderState {
        return {
            activeNotes: this.activeNotes,
            selectedNotes: this.selectedNotes,
            dragState: this.dragState,
            selectionBox: this.selectionBox,
        }
    }

    private renderGridLayer(): void {
        if (!this.ctx) return
        renderGrid(this.ctx, this.getCoordinateParams(), this.getRenderOptions())
    }

    private renderNotesLayer(): void {
        if (!this.ctx) return
        renderNotes(
            this.ctx,
            this.notes,
            this.getCoordinateParams(),
            this.getNoteRenderState(),
            this.getNoteColorOptions(),
            this.getRenderOptions()
        )
    }

    private renderKeyboardLayer(): void {
        if (!this.keyboardCtx || !this.keyboardCanvas) return

        const activePitches = new Set<number>()
        for (const note of this.activeNotes) {
            activePitches.add(note.pitch)
        }

        renderKeyboard(
            this.keyboardCtx,
            this.keyboardCanvas.width,
            this.keyboardCanvas.height,
            this.getCoordinateParams(),
            activePitches,
            this.getOptions().playheadColor
        )
    }

    private renderSpectrogramLayer(): void {
        if (!this.spectrogramCtx || !this.spectrogramCanvas) return

        const opts = this.getOptions()
        renderSpectrogram(
            this.spectrogramCtx,
            this.spectrogramCanvas.width,
            this.spectrogramCanvas.height,
            this.spectrogramData,
            this.audioSampleRate,
            this.currentFftSize,
            this.getCoordinateParams(),
            opts.backgroundColor,
            opts.spectrogramColorMap as ColorMapType
        )
    }

    private calculateSpectrogramData(audioBuffer: AudioBuffer): void {
        const opts = this.getOptions()
        if (!opts.showSpectrogram) return

        this.cachedAudioBuffer = audioBuffer
        this.audioSampleRate = audioBuffer.sampleRate

        let audioData: Float32Array
        if (audioBuffer.numberOfChannels === 1) {
            audioData = audioBuffer.getChannelData(0)
        } else {
            const left = audioBuffer.getChannelData(0)
            const right = audioBuffer.getChannelData(1)
            audioData = new Float32Array(left.length)
            for (let i = 0; i < left.length; i++) {
                audioData[i] = (left[i] + right[i]) / 2
            }
        }

        const fftSize = this.currentFftSize
        const overlap = Math.max(0, Math.min(0.95, opts.spectrogramOverlap))
        const hopSize = Math.max(1, Math.floor(fftSize * (1 - overlap)))
        this.spectrogramData = calculateSpectrogram(audioData, this.audioSampleRate, fftSize, hopSize)

        this.render()
    }

    // ==================== Event Handlers ====================

    private onZoom = (): void => {
        this.render()
        this.updatePlayhead()
    }

    private onScroll = (): void => {
        this.updatePlayhead()
    }

    private onRedraw = (): void => {
        this.render()
    }

    private onTimeUpdate = (time: number): void => {
        this.currentTime = time
        this.updatePlayhead()
        this.updateActiveNotes()
    }

    private onMouseMove = (event: MouseEvent): void => {
        if (!this.container || !this.wavesurfer) return
        if (this.dragState) return

        const rect = this.container.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top

        const note = this.findNoteAtPosition(x, y)
        this.updateCursor(x, note, event.shiftKey)

        if (note !== this.hoveredNote) {
            this.hoveredNote = note
            this.updateTooltip(x, y)
            this.emit('notehover', note, event)
        } else if (note && this.tooltip) {
            this.updateTooltipPosition(x, y)
        }
    }

    private onMouseLeave = (): void => {
        this.hoveredNote = null
        if (this.tooltip) this.tooltip.style.display = 'none'
        if (this.container && !this.dragState) this.container.style.cursor = 'default'
    }

    private getDragMode(x: number, note: PianoRollNote): 'move' | 'resize-left' | 'resize-right' {
        const noteX = this.timeToPx(note.onset)
        const noteW = Math.max(this.timeToPx(note.offset) - noteX, 2)

        if (x - noteX < this.EDGE_THRESHOLD) return 'resize-left'
        if (noteX + noteW - x < this.EDGE_THRESHOLD) return 'resize-right'
        return 'move'
    }

    private onMouseDown = (event: MouseEvent): void => {
        if (!this.container) return

        const rect = this.container.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top

        const note = this.findNoteAtPosition(x, y)

        // Start box selection if clicking on empty space
        if (!note) {
            event.preventDefault()
            if (!event.shiftKey) {
                this.selectedNotes.clear()
                this.emit('selectionchange', [])
            }

            this.selectionBox = {
                startX: x,
                startY: y,
                endX: x,
                endY: y,
                active: true,
            }

            this.container.style.cursor = 'crosshair'
            document.addEventListener('mousemove', this.onSelectionDrag)
            document.addEventListener('mouseup', this.onSelectionEnd)
            return
        }

        // Shift+click to delete
        if (event.shiftKey) {
            event.preventDefault()
            this.deleteNote(note)
            return
        }

        event.preventDefault()

        const noteX = this.timeToPx(note.onset)
        const noteY = this.pitchToPx(note.pitch)
        const mode = this.getDragMode(x, note)
        const originalNote: PianoRollNote = { ...note }

        this.dragState = {
            note,
            originalNote,
            mode,
            startX: x,
            startY: y,
            offsetX: x - noteX,
            offsetY: y - noteY,
            lastPreviewPitch: note.pitch,
        }

        // Multi-drag setup
        if (mode === 'move' && this.selectedNotes.has(note) && this.selectedNotes.size > 1) {
            const notes = Array.from(this.selectedNotes)
            const originals = notes.map(n => ({ ...n }))
            this.dragState.multiDrag = { notes, originals }
        }

        this.container.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize'
        if (this.tooltip) this.tooltip.style.display = 'none'

        document.addEventListener('mousemove', this.onDragMove)
        document.addEventListener('mouseup', this.onDragEnd)
    }

    private onDragMove = (event: MouseEvent): void => {
        if (!this.dragState || !this.container || !this.wavesurfer) return

        const rect = this.container.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top

        const { note, originalNote, mode, offsetX, multiDrag } = this.dragState
        const duration = this.wavesurfer.getDuration()

        if (mode === 'move') {
            const deltaTime = this.pxToTime(x - offsetX) - originalNote.onset
            const newPitch = this.pxToPitch(y)
            const deltaPitch = newPitch - originalNote.pitch

            if (multiDrag) {
                for (let i = 0; i < multiDrag.notes.length; i++) {
                    const n = multiDrag.notes[i]
                    const orig = multiDrag.originals[i]
                    const noteDuration = orig.duration

                    let newOnset = orig.onset + deltaTime
                    newOnset = Math.max(0, Math.min(duration - noteDuration, newOnset))

                    n.onset = newOnset
                    n.offset = newOnset + noteDuration

                    const targetPitch = clampPitch(orig.pitch + deltaPitch)
                    if (n.pitch !== targetPitch) {
                        n.pitch = targetPitch
                        n.name = pitchToNoteName(targetPitch)
                    }
                }

                if (this.synthManager.enabled && newPitch !== this.dragState.lastPreviewPitch) {
                    this.synthManager.previewPitch(newPitch)
                    this.dragState.lastPreviewPitch = newPitch
                }
            } else {
                const noteDuration = note.duration
                let newOnset = this.pxToTime(x - offsetX)
                newOnset = Math.max(0, Math.min(duration - noteDuration, newOnset))

                note.onset = newOnset
                note.offset = newOnset + noteDuration

                if (note.pitch !== newPitch) {
                    note.pitch = newPitch
                    note.name = pitchToNoteName(newPitch)

                    if (this.synthManager.enabled && newPitch !== this.dragState.lastPreviewPitch) {
                        this.synthManager.previewPitch(newPitch)
                        this.dragState.lastPreviewPitch = newPitch
                    }
                }
            }
        } else if (mode === 'resize-left') {
            let newOnset = this.pxToTime(x)
            const maxOnset = note.offset - this.MIN_NOTE_DURATION
            newOnset = Math.max(0, Math.min(maxOnset, newOnset))
            note.onset = newOnset
            note.duration = note.offset - note.onset
        } else if (mode === 'resize-right') {
            let newOffset = this.pxToTime(x)
            const minOffset = note.onset + this.MIN_NOTE_DURATION
            newOffset = Math.max(minOffset, Math.min(duration, newOffset))
            note.offset = newOffset
            note.duration = note.offset - note.onset
        }

        this.render()
    }

    private onDragEnd = (): void => {
        if (!this.dragState || !this.container) return

        const { note, originalNote, mode, multiDrag } = this.dragState

        if (multiDrag && mode === 'move') {
            let anyChanged = false
            for (let i = 0; i < multiDrag.notes.length; i++) {
                const n = multiDrag.notes[i]
                const orig = multiDrag.originals[i]
                const hasChanged = n.onset !== orig.onset || n.offset !== orig.offset || n.pitch !== orig.pitch
                if (hasChanged) {
                    anyChanged = true
                    this.emit('notedrag', n, orig)
                }
            }
            if (anyChanged) this.emit('noteschange')
        } else {
            const hasChanged = note.onset !== originalNote.onset || note.offset !== originalNote.offset || note.pitch !== originalNote.pitch
            if (hasChanged) {
                if (mode === 'move') {
                    this.emit('notedrag', note, originalNote)
                } else {
                    this.emit('noteresize', note, originalNote)
                }
                this.emit('noteschange')
            }
        }

        this.container.style.cursor = 'default'
        this.synthManager.stopAllNotes()
        this.dragState = null

        document.removeEventListener('mousemove', this.onDragMove)
        document.removeEventListener('mouseup', this.onDragEnd)

        this.render()
    }

    private onSelectionDrag = (event: MouseEvent): void => {
        if (!this.selectionBox || !this.container) return

        const rect = this.container.getBoundingClientRect()
        this.selectionBox.endX = event.clientX - rect.left
        this.selectionBox.endY = event.clientY - rect.top

        this.render()
    }

    private onSelectionEnd = (): void => {
        if (!this.selectionBox || !this.container) return

        const box = this.selectionBox
        const minX = Math.min(box.startX, box.endX)
        const maxX = Math.max(box.startX, box.endX)
        const minY = Math.min(box.startY, box.endY)
        const maxY = Math.max(box.startY, box.endY)

        const noteHeight = this.getNoteHeight()

        for (const note of this.notes) {
            if (note.pitch < this.minPitch || note.pitch > this.maxPitch) continue
            if (this.isFolded && !this.usedPitches.includes(note.pitch)) continue

            const noteX = this.timeToPx(note.onset)
            const noteW = Math.max(this.timeToPx(note.offset) - noteX, 2)
            const noteY = this.pitchToPx(note.pitch)
            const noteH = noteHeight - 1

            const noteRight = noteX + noteW
            const noteBottom = noteY + noteH

            if (noteX <= maxX && noteRight >= minX && noteY <= maxY && noteBottom >= minY) {
                this.selectedNotes.add(note)
            }
        }

        this.emit('selectionchange', Array.from(this.selectedNotes))

        this.container.style.cursor = 'default'
        this.selectionBox = null

        document.removeEventListener('mousemove', this.onSelectionDrag)
        document.removeEventListener('mouseup', this.onSelectionEnd)

        this.render()
    }

    private updateCursor(x: number, note: PianoRollNote | null, shiftKey = false): void {
        if (!this.container || this.dragState) return

        if (!note) {
            this.container.style.cursor = 'default'
            return
        }

        if (shiftKey) {
            this.container.style.cursor = 'not-allowed'
            return
        }

        const mode = this.getDragMode(x, note)
        this.container.style.cursor = mode === 'move' ? 'grab' : 'ew-resize'
    }

    private deleteNote(note: PianoRollNote): void {
        const index = this.notes.indexOf(note)
        if (index === -1) return

        this.notes.splice(index, 1)
        this.updateUsedPitches()
        this.render()

        this.emit('notedelete', note)
        this.emit('noteschange')
    }

    private detectSpectrogramNote(x: number, y: number): { pitch: number; onset: number; offset: number } | null {
        if (!this.wavesurfer || this.spectrogramData.length === 0) return null

        const wrapper = this.wavesurfer.getWrapper()
        const duration = this.wavesurfer.getDuration()
        const displayWidth = wrapper.scrollWidth

        const clickPitch = this.pxToPitch(y)
        const clickFreq = midiToHz(clickPitch)
        const binFloat = (clickFreq / this.audioSampleRate) * this.currentFftSize
        const bin = Math.round(binFloat)

        if (bin < 0 || bin >= this.currentFftSize / 2) return null

        const frameFloat = (x / displayWidth) * (this.spectrogramData.length - 1)
        const frameIndex = Math.round(frameFloat)

        if (frameIndex < 0 || frameIndex >= this.spectrogramData.length) return null

        const frame = this.spectrogramData[frameIndex]
        const magnitude = frame[bin] || 0

        let maxMag = 0
        for (let i = 0; i < frame.length; i++) {
            if (frame[i] > maxMag) maxMag = frame[i]
        }

        if (magnitude < maxMag * 0.2) return null

        const threshold = magnitude * 0.2
        const searchRadius = Math.round((clickFreq * 0.12) / this.audioSampleRate * this.currentFftSize)
        let peakBin = bin
        let peakMag = magnitude
        for (let b = Math.max(0, bin - searchRadius); b <= Math.min(frame.length - 1, bin + searchRadius); b++) {
            if (frame[b] > peakMag) {
                peakMag = frame[b]
                peakBin = b
            }
        }

        const peakFreq = (peakBin * this.audioSampleRate) / this.currentFftSize
        const detectedPitch = clampPitch(Math.round(69 + 12 * Math.log2(peakFreq / 440)))

        let onsetFrame = frameIndex
        for (let f = frameIndex - 1; f >= 0; f--) {
            const binMag = this.spectrogramData[f][peakBin] || 0
            if (binMag < threshold) {
                onsetFrame = f + 1
                break
            }
            onsetFrame = f
        }

        let offsetFrame = frameIndex
        for (let f = frameIndex + 1; f < this.spectrogramData.length; f++) {
            const binMag = this.spectrogramData[f][peakBin] || 0
            if (binMag < threshold) {
                offsetFrame = f - 1
                break
            }
            offsetFrame = f
        }

        const onset = (onsetFrame / (this.spectrogramData.length - 1)) * duration
        const offset = Math.min(((offsetFrame + 1) / (this.spectrogramData.length - 1)) * duration, duration)

        if (offset - onset < this.MIN_NOTE_DURATION) {
            return { pitch: detectedPitch, onset, offset: onset + 0.25 }
        }

        return { pitch: detectedPitch, onset, offset }
    }

    private onDoubleClick = (event: MouseEvent): void => {
        if (!this.container || !this.wavesurfer) return

        const rect = this.container.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top

        const existingNote = this.findNoteAtPosition(x, y)
        if (existingNote) return

        let pitch: number
        let onset: number
        let offset: number

        if (this.snapEnabled && this.spectrogramData.length > 0) {
            const detected = this.detectSpectrogramNote(x, y)
            if (detected) {
                pitch = detected.pitch
                onset = detected.onset
                offset = detected.offset
            } else {
                onset = this.pxToTime(x)
                pitch = this.pxToPitch(y)
                const duration = this.wavesurfer.getDuration()
                offset = Math.min(onset + 0.25, duration)
            }
        } else {
            onset = this.pxToTime(x)
            pitch = this.pxToPitch(y)
            const duration = this.wavesurfer.getDuration()
            offset = Math.min(onset + 0.25, duration)
        }

        const newNote: PianoRollNote = {
            pitch,
            name: pitchToNoteName(pitch),
            onset,
            offset,
            duration: offset - onset,
            velocity: 0.8,
            track: 0,
            channel: 0,
        }

        this.notes.push(newNote)
        this.notes.sort((a, b) => a.onset - b.onset)
        this.updateUsedPitches()

        if (this.synthManager.enabled) {
            this.synthManager.triggerNote(newNote)
            setTimeout(() => this.synthManager.releaseNote(newNote), 200)
        }

        this.render()

        this.emit('notecreate', newNote)
        this.emit('noteschange')
    }

    private findNoteAtPosition(x: number, y: number): PianoRollNote | null {
        const noteHeight = this.getNoteHeight()

        for (const note of this.notes) {
            if (note.pitch < this.minPitch || note.pitch > this.maxPitch) continue
            if (this.isFolded && !this.usedPitches.includes(note.pitch)) continue

            const noteX = this.timeToPx(note.onset)
            const noteW = Math.max(this.timeToPx(note.offset) - noteX, 2)
            const noteY = this.pitchToPx(note.pitch)
            const noteH = noteHeight - 1

            if (x >= noteX && x <= noteX + noteW && y >= noteY && y <= noteY + noteH) {
                return note
            }
        }

        return null
    }

    private updateTooltip(x: number, y: number): void {
        if (!this.tooltip) return

        if (!this.hoveredNote) {
            this.tooltip.style.display = 'none'
            return
        }

        const note = this.hoveredNote
        const duration = (note.duration * 1000).toFixed(0)
        this.tooltip.innerHTML = `<strong>${note.name}</strong> ${note.onset.toFixed(2)}s (${duration}ms)`
        this.tooltip.style.display = 'block'

        this.updateTooltipPosition(x, y)
    }

    private updateTooltipPosition(x: number, y: number): void {
        if (!this.tooltip || !this.container) return

        const containerRect = this.container.getBoundingClientRect()
        const tooltipRect = this.tooltip.getBoundingClientRect()

        let tooltipX = x - tooltipRect.width / 2
        let tooltipY = y - tooltipRect.height - 8

        if (tooltipX < 4) tooltipX = 4
        if (tooltipX + tooltipRect.width > containerRect.width - 4) {
            tooltipX = containerRect.width - tooltipRect.width - 4
        }
        if (tooltipY < 4) tooltipY = y + 20

        this.tooltip.style.left = `${tooltipX}px`
        this.tooltip.style.top = `${tooltipY}px`
    }

    private updatePlayhead(): void {
        if (!this.playhead || !this.wavesurfer) return
        const x = this.timeToPx(this.currentTime)
        this.playhead.style.left = `${x}px`
    }

    private updateActiveNotes(): void {
        const previousActive = new Set(this.activeNotes)
        this.activeNotes.clear()

        for (const note of this.notes) {
            if (this.currentTime >= note.onset && this.currentTime < note.offset) {
                this.activeNotes.add(note)
                if (!previousActive.has(note)) {
                    this.synthManager.triggerNote(note)
                }
            }
        }

        for (const note of previousActive) {
            if (!this.activeNotes.has(note)) {
                this.synthManager.releaseNote(note)
            }
        }

        if (this.activeNotes.size !== previousActive.size || this.activeNotes.size > 0) {
            this.render()
        }
    }

    private detectPitchRange(): void {
        if (this.notes.length === 0) {
            this.minPitch = this.options.minPitch ?? 21
            this.maxPitch = this.options.maxPitch ?? 108
            return
        }

        const pitches = this.notes.map(n => n.pitch)
        const minNote = Math.min(...pitches)
        const maxNote = Math.max(...pitches)

        this.minPitch = this.options.minPitch ?? Math.max(0, Math.floor((minNote - 2) / 12) * 12)
        this.maxPitch = this.options.maxPitch ?? Math.min(127, Math.ceil((maxNote + 2) / 12) * 12 + 11)
    }

    private normalizeNote(input: PianoRollNoteInput, pitchIsHz = false): PianoRollNote {
        const pitch = clampPitch(toMidiPitch(input.pitch, pitchIsHz))
        const onset = input.onset
        const duration = input.duration ?? (input.offset ? input.offset - input.onset : 0.1)
        const offset = input.offset ?? onset + duration

        let velocity = input.velocity ?? 0.8
        if (velocity > 1) velocity = velocity / 127

        return {
            pitch,
            name: pitchToNoteName(pitch),
            onset,
            offset,
            duration,
            velocity,
            track: input.track ?? 0,
            channel: input.channel ?? 0,
            color: input.color,
        }
    }

    // ==================== Public API ====================

    public async loadMidi(url: string): Promise<void> {
        const response = await fetch(url)
        const arrayBuffer = await response.arrayBuffer()
        this.loadMidiData(arrayBuffer)
    }

    public loadMidiData(data: ArrayBuffer): void {
        const midi = new Midi(data)

        this.notes = []
        this.trackCount = midi.tracks.length

        midi.tracks.forEach((track, trackIndex) => {
            track.notes.forEach((note) => {
                this.notes.push({
                    pitch: note.midi,
                    name: note.name,
                    onset: note.time,
                    offset: note.time + note.duration,
                    duration: note.duration,
                    velocity: note.velocity,
                    track: trackIndex,
                    channel: track.channel ?? 0,
                })
            })
        })

        this.notes.sort((a, b) => a.onset - b.onset)

        this.detectPitchRange()
        this.updateUsedPitches()
        this.render()
        this.emit('load', this.notes.length, this.trackCount)
    }

    public loadNotes(notes: PianoRollNoteInput[], pitchIsHz = false): void {
        this.notes = notes.map(n => this.normalizeNote(n, pitchIsHz))
        this.notes.sort((a, b) => a.onset - b.onset)

        this.trackCount = new Set(this.notes.map(n => n.track)).size

        this.detectPitchRange()
        this.updateUsedPitches()
        this.render()
        this.emit('load', this.notes.length, this.trackCount)
    }

    public loadCSV(csv: string, options: CSVParseOptions = {}): void {
        const {
            hasHeader = false,
            onsetColumn = 0,
            pitchColumn = 1,
            durationColumn = 2,
            pitchIsHz,
            delimiter = ',',
        } = options

        const lines = csv.trim().split('\n')
        const startLine = hasHeader ? 1 : 0

        const notes: PianoRollNoteInput[] = []

        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i].trim()
            if (!line) continue

            const cols = line.split(delimiter)
            const onset = parseFloat(cols[onsetColumn])
            const pitch = parseFloat(cols[pitchColumn])
            const duration = parseFloat(cols[durationColumn])

            if (isNaN(onset) || isNaN(pitch) || isNaN(duration)) continue

            notes.push({ pitch, onset, duration })
        }

        let detectHz = pitchIsHz
        if (detectHz === undefined && notes.length > 0) {
            detectHz = notes.some(n => (n.pitch as number) > 127)
        }

        this.loadNotes(notes, detectHz)
    }

    public clearNotes(): void {
        this.notes = []
        this.trackCount = 0
        this.usedPitches = []
        this.detectPitchRange()
        this.render()
    }

    public getNotes(): PianoRollNote[] {
        return [...this.notes]
    }

    public getNotesInRange(startTime: number, endTime: number): PianoRollNote[] {
        return this.notes.filter(n => n.onset >= startTime && n.onset < endTime)
    }

    public getNotesAtPitch(pitch: number): PianoRollNote[] {
        return this.notes.filter(n => n.pitch === pitch)
    }

    public getSelectedNotes(): PianoRollNote[] {
        return Array.from(this.selectedNotes)
    }

    public clearSelection(): void {
        if (this.selectedNotes.size > 0) {
            this.selectedNotes.clear()
            this.render()
            this.emit('selectionchange', [])
        }
    }

    public selectNotes(notes: PianoRollNote[]): void {
        this.selectedNotes.clear()
        for (const note of notes) {
            if (this.notes.includes(note)) {
                this.selectedNotes.add(note)
            }
        }
        this.render()
        this.emit('selectionchange', Array.from(this.selectedNotes))
    }

    public deleteSelectedNotes(): void {
        if (this.selectedNotes.size === 0) return

        for (const note of this.selectedNotes) {
            const index = this.notes.indexOf(note)
            if (index !== -1) {
                this.notes.splice(index, 1)
                this.emit('notedelete', note)
            }
        }

        this.selectedNotes.clear()
        this.updateUsedPitches()
        this.render()
        this.emit('selectionchange', [])
        this.emit('noteschange')
    }

    public setPitchRange(min: number, max: number): void {
        this.minPitch = clampPitch(min)
        this.maxPitch = clampPitch(max)
        this.render()
    }

    // ==================== Export Methods ====================

    public exportMidi(filename = 'notes.mid', tempo = 120): void {
        if (this.notes.length === 0) {
            console.warn('No notes to export')
            return
        }

        const midi = new Midi()
        midi.header.setTempo(tempo)

        const trackMap = new Map<number, PianoRollNote[]>()
        for (const note of this.notes) {
            const trackIdx = note.track
            if (!trackMap.has(trackIdx)) {
                trackMap.set(trackIdx, [])
            }
            trackMap.get(trackIdx)!.push(note)
        }

        trackMap.forEach((trackNotes, trackIdx) => {
            const midiTrack = midi.addTrack()
            midiTrack.name = `Track ${trackIdx + 1}`

            for (const note of trackNotes) {
                midiTrack.addNote({
                    midi: note.pitch,
                    time: note.onset,
                    duration: note.duration,
                    velocity: note.velocity,
                })
            }
        })

        const midiArray = midi.toArray()
        this.downloadFile(midiArray, filename, 'audio/midi')
    }

    public exportJSON(filename = 'notes.json'): void {
        if (this.notes.length === 0) {
            console.warn('No notes to export')
            return
        }

        const exportData = {
            version: '1.0',
            noteCount: this.notes.length,
            trackCount: this.trackCount,
            pitchRange: { min: this.minPitch, max: this.maxPitch },
            notes: this.notes.map(note => ({
                pitch: note.pitch,
                name: note.name,
                onset: note.onset,
                offset: note.offset,
                duration: note.duration,
                velocity: note.velocity,
                track: note.track,
                channel: note.channel,
                ...(note.color ? { color: note.color } : {}),
            })),
        }

        const jsonString = JSON.stringify(exportData, null, 2)
        const encoder = new TextEncoder()
        const data = encoder.encode(jsonString)
        this.downloadFile(data, filename, 'application/json')
    }

    private downloadFile(data: Uint8Array | ArrayBuffer, filename: string, mimeType: string): void {
        const blob = new Blob([data as BlobPart], { type: mimeType })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }

    // ==================== Lifecycle ====================

    protected onInit(): void {
        if (!this.wavesurfer) {
            throw new Error('WaveSurfer is not initialized')
        }

        this.createElements()

        const wrapper = this.wavesurfer.getWrapper()
        const scrollContainer = wrapper.parentElement

        if (scrollContainer) {
            scrollContainer.addEventListener('scroll', this.onScroll)
        }

        this.subscriptions.push(this.wavesurfer.on('zoom', this.onZoom))
        this.subscriptions.push(this.wavesurfer.on('redrawcomplete', this.onRedraw))
        this.subscriptions.push(this.wavesurfer.on('timeupdate', this.onTimeUpdate))

        this.subscriptions.push(
            this.wavesurfer.on('seeking', (time: number) => {
                this.currentTime = time
                this.updatePlayhead()
                this.updateActiveNotes()
            })
        )

        this.subscriptions.push(
            this.wavesurfer.on('pause', () => {
                this.synthManager.stopAllNotes()
            })
        )

        const opts = this.getOptions()
        if (opts.showSpectrogram) {
            this.subscriptions.push(
                this.wavesurfer.on('decode', () => {
                    const audioBuffer = this.wavesurfer?.getDecodedData()
                    if (audioBuffer) {
                        this.calculateSpectrogramData(audioBuffer)
                    }
                })
            )
        }

        this.detectPitchRange()
        this.render()

        this.currentTime = this.wavesurfer.getCurrentTime()
        this.updatePlayhead()

        this.emit('ready')
    }

    public _init(wavesurfer: WaveSurfer): void {
        this.wavesurfer = wavesurfer
        this.onInit()
    }

    public destroy(): void {
        this.emit('destroy')

        if (this.wavesurfer) {
            const wrapper = this.wavesurfer.getWrapper()
            const scrollContainer = wrapper.parentElement
            if (scrollContainer) {
                scrollContainer.removeEventListener('scroll', this.onScroll)
            }
        }

        if (this.container) {
            this.container.removeEventListener('mousemove', this.onMouseMove)
            this.container.removeEventListener('mouseleave', this.onMouseLeave)
            this.container.removeEventListener('mousedown', this.onMouseDown)
            this.container.removeEventListener('dblclick', this.onDoubleClick)
        }

        if (this.dragState) {
            document.removeEventListener('mousemove', this.onDragMove)
            document.removeEventListener('mouseup', this.onDragEnd)
            this.dragState = null
        }

        if (this.selectionBox) {
            document.removeEventListener('mousemove', this.onSelectionDrag)
            document.removeEventListener('mouseup', this.onSelectionEnd)
            this.selectionBox = null
        }
        this.selectedNotes.clear()

        this.subscriptions.forEach((unsubscribe) => unsubscribe())
        this.subscriptions = []

        // Remove controls container (it's attached to userContainer, not this.container)
        this.controlsContainer?.remove()
        this.container?.remove()

        this.synthManager.dispose()

        this.container = null
        this.canvas = null
        this.ctx = null
        this.keyboardCanvas = null
        this.keyboardCtx = null
        this.spectrogramCanvas = null
        this.spectrogramCtx = null
        this.playhead = null
        this.foldButton = null
        this.previewButton = null
        this.controlsContainer = null
        this.tooltip = null
        this.hoveredNote = null
        this.notes = []
        this.usedPitches = []
        this.spectrogramData = []
        this.activeNotes.clear()
    }
}
