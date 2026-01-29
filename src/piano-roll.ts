import type WaveSurfer from 'wavesurfer.js'
import { BasePlugin } from 'wavesurfer.js/dist/base-plugin.js'
import { Midi } from '@tonejs/midi'
import * as Tone from 'tone'

/** Available synth types for preview */
export type PreviewSynthType = 'sine' | 'synth' | 'piano'
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
    isBlackKey,
    clampPitch,
    midiToHz,
} from './piano-roll/note-utils'
import {
    calculateSpectrogram,
    renderSpectrogramToImageData,
    type ColorMapType,
} from './piano-roll/spectrogram'

// Re-export types
export type {
    PianoRollPluginEvents,
    PianoRollPluginOptions,
    PianoRollNote,
    PianoRollNoteInput,
    CSVParseOptions,
}

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
    private usedPitches: number[] = [] // Sorted list of pitches that have notes

    // Playback state
    private currentTime = 0
    private activeNotes: Set<PianoRollNote> = new Set()

    // Preview synth state
    private previewEnabled = false
    private previewButton: HTMLButtonElement | null = null

    // Snap to spectrogram state
    private snapEnabled = false
    private snapCheckbox: HTMLInputElement | null = null
    private synthTypeSelect: HTMLSelectElement | null = null
    private currentSynthType: PreviewSynthType = 'synth'
    private sineSynth: Tone.PolySynth | null = null
    private triangleSynth: Tone.PolySynth | null = null
    private pianoSynth: Tone.PolySynth | null = null  // FM synth with piano-like sound
    private playingNotes: Set<string> = new Set() // Track which notes are currently sounding

    // Drag state for note editing (supports multi-select)
    private dragState: {
        note: PianoRollNote
        originalNote: PianoRollNote
        mode: 'move' | 'resize-left' | 'resize-right'
        startX: number
        startY: number
        offsetX: number
        offsetY: number
        lastPreviewPitch: number
        // For multi-select drag: all selected notes and their originals
        multiDrag?: {
            notes: PianoRollNote[]
            originals: PianoRollNote[]
        }
    } | null = null
    private readonly EDGE_THRESHOLD = 8 // Pixels from edge to trigger resize mode
    private readonly MIN_NOTE_DURATION = 0.05 // Minimum note duration in seconds

    // FFT size for spectrogram (can be changed at runtime)
    private currentFftSize: number = 1024
    private fftSelect: HTMLSelectElement | null = null
    private cachedAudioBuffer: AudioBuffer | null = null

    // Selection state for multi-select
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

    /**
     * Factory method to create a new PianoRollPlugin instance
     */
    public static create(options?: PianoRollPluginOptions): PianoRollPlugin {
        return new PianoRollPlugin(options || {})
    }

    /**
     * Get default options
     */
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
            // Spectrogram options
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

    /**
     * Convert time to pixel position
     */
    private timeToPx(time: number): number {
        if (!this.wavesurfer) return 0
        const wrapper = this.wavesurfer.getWrapper()
        const duration = this.wavesurfer.getDuration()
        if (duration === 0) return 0
        return (time / duration) * wrapper.scrollWidth
    }

    /**
     * Convert pixel position to time
     */
    public pxToTime(px: number): number {
        if (!this.wavesurfer) return 0
        const wrapper = this.wavesurfer.getWrapper()
        const duration = this.wavesurfer.getDuration()
        return (px / wrapper.scrollWidth) * duration
    }

    /**
     * Get the list of pitches to display (folded or full range)
     */
    private getDisplayPitches(): number[] {
        if (this.isFolded && this.usedPitches.length > 0) {
            return this.usedPitches
        }
        // Full range from minPitch to maxPitch
        const pitches: number[] = []
        for (let p = this.minPitch; p <= this.maxPitch; p++) {
            pitches.push(p)
        }
        return pitches
    }

    /**
     * Get the display height (CSS pixels, not canvas pixels which may be DPR-scaled)
     */
    private getDisplayHeight(): number {
        return this.getOptions().height
    }

    /**
     * Convert MIDI pitch to Y pixel position
     */
    private pitchToPx(pitch: number): number {
        if (!this.canvas) return 0
        const pitches = this.getDisplayPitches()
        const displayHeight = this.getDisplayHeight()
        const noteHeight = displayHeight / pitches.length

        if (this.isFolded) {
            // Find index of pitch in used pitches (reversed for high at top)
            const idx = pitches.indexOf(pitch)
            if (idx === -1) return -100 // Off-screen if not in list
            return displayHeight - ((idx + 1) * noteHeight)
        } else {
            // Higher pitches at top (lower Y)
            return displayHeight - ((pitch - this.minPitch + 1) * noteHeight)
        }
    }

    /**
     * Get the height of a single note in pixels
     */
    private getNoteHeight(): number {
        if (!this.canvas) return 10
        const pitches = this.getDisplayPitches()
        const displayHeight = this.getDisplayHeight()
        return displayHeight / pitches.length
    }

    /**
     * Convert Y pixel position to MIDI pitch (reverse of pitchToPx)
     */
    private pxToPitch(y: number): number {
        if (!this.canvas) return 60 // Middle C fallback
        const pitches = this.getDisplayPitches()
        const displayHeight = this.getDisplayHeight()
        const noteHeight = displayHeight / pitches.length

        if (this.isFolded) {
            // In folded mode: find which pitch index this Y falls into
            const idx = Math.floor((displayHeight - y) / noteHeight)
            if (idx < 0) return pitches[0]
            if (idx >= pitches.length) return pitches[pitches.length - 1]
            return pitches[idx]
        } else {
            // In full mode: calculate from pitch range
            // Reverse of: y = displayHeight - ((pitch - minPitch + 1) * noteHeight)
            const pitch = this.minPitch + (displayHeight - y) / noteHeight - 1
            return clampPitch(Math.round(pitch))
        }
    }

    /**
     * Update the list of used pitches (called after loading notes)
     */
    private updateUsedPitches(): void {
        const pitchSet = new Set<number>()
        for (const note of this.notes) {
            pitchSet.add(note.pitch)
        }
        this.usedPitches = Array.from(pitchSet).sort((a, b) => a - b)
    }

    /**
     * Toggle fold state
     */
    public toggleFold(): void {
        this.isFolded = !this.isFolded
        this.updateFoldButton()
        this.render()
    }

    /**
     * Set FFT size for spectrogram and recalculate
     */
    public setFftSize(size: number): void {
        // Ensure size is a power of 2
        const validSizes = [256, 512, 1024, 2048, 4096, 8192]
        if (!validSizes.includes(size)) {
            console.warn(`Invalid FFT size ${size}, must be one of: ${validSizes.join(', ')}`)
            return
        }

        this.currentFftSize = size

        // Recalculate spectrogram if we have cached audio
        if (this.cachedAudioBuffer) {
            this.calculateSpectrogramData(this.cachedAudioBuffer)
        }
    }

    /**
     * Set fold state
     */
    public setFolded(folded: boolean): void {
        this.isFolded = folded
        this.updateFoldButton()
        this.render()
    }

    /**
     * Update fold button appearance
     */
    private updateFoldButton(): void {
        if (!this.foldButton) return
        this.foldButton.textContent = this.isFolded ? 'Unfold' : 'Fold'
        this.foldButton.style.backgroundColor = this.isFolded ? '#4ecca3' : '#333'
    }

    /**
     * Toggle MIDI preview on/off
     */
    public async togglePreview(): Promise<void> {
        this.previewEnabled = !this.previewEnabled
        this.updatePreviewButton()

        if (this.previewEnabled) {
            // Start Tone.js audio context (requires user gesture)
            await Tone.start()
            await this.initCurrentSynth()
        } else {
            // Stop all playing notes
            this.stopAllPreviewNotes()
        }
    }

    /**
     * Set the synth type
     */
    public async setSynthType(type: PreviewSynthType): Promise<void> {
        if (type === this.currentSynthType) return

        // Stop any playing notes first
        this.stopAllPreviewNotes()

        this.currentSynthType = type

        // Initialize the new synth if preview is enabled
        if (this.previewEnabled) {
            await this.initCurrentSynth()
        }
    }

    /**
     * Initialize the current synth type
     */
    private async initCurrentSynth(): Promise<void> {
        switch (this.currentSynthType) {
            case 'sine':
                if (!this.sineSynth) {
                    this.sineSynth = new Tone.PolySynth(Tone.Synth, {
                        oscillator: { type: 'sine' },
                        envelope: {
                            attack: 0.02,
                            decay: 0.1,
                            sustain: 0.5,
                            release: 0.3,
                        },
                    }).toDestination()
                    this.sineSynth.volume.value = -12
                }
                break
            case 'synth':
                if (!this.triangleSynth) {
                    this.triangleSynth = new Tone.PolySynth(Tone.Synth, {
                        oscillator: { type: 'triangle' },
                        envelope: {
                            attack: 0.02,
                            decay: 0.1,
                            sustain: 0.3,
                            release: 0.3,
                        },
                    }).toDestination()
                    this.triangleSynth.volume.value = -12
                }
                break
            case 'piano':
                // Use FM synth for piano-like sound (no sample loading needed)
                if (!this.pianoSynth) {
                    this.pianoSynth = new Tone.PolySynth(Tone.FMSynth, {
                        harmonicity: 3,
                        modulationIndex: 10,
                        oscillator: { type: 'sine' },
                        envelope: {
                            attack: 0.001,
                            decay: 0.4,
                            sustain: 0.1,
                            release: 1.2,
                        },
                        modulation: { type: 'square' },
                        modulationEnvelope: {
                            attack: 0.002,
                            decay: 0.2,
                            sustain: 0,
                            release: 0.2,
                        },
                    }).toDestination()
                    this.pianoSynth.volume.value = -8
                }
                break
        }
    }

    /**
     * Update preview button appearance
     */
    private updatePreviewButton(): void {
        if (!this.previewButton) return
        this.previewButton.style.backgroundColor = this.previewEnabled ? '#4ecca3' : '#333'
    }

    /**
     * Trigger a note on the preview synth
     */
    private triggerPreviewNote(note: PianoRollNote): void {
        if (!this.previewEnabled) return

        const noteId = `${note.pitch}-${note.onset}`
        if (this.playingNotes.has(noteId)) return
        this.playingNotes.add(noteId)

        const freq = Tone.Frequency(note.pitch, 'midi').toFrequency()

        switch (this.currentSynthType) {
            case 'sine':
                this.sineSynth?.triggerAttack(freq, Tone.now(), note.velocity)
                break
            case 'synth':
                this.triangleSynth?.triggerAttack(freq, Tone.now(), note.velocity)
                break
            case 'piano':
                this.pianoSynth?.triggerAttack(freq, Tone.now(), note.velocity)
                break
        }
    }

    /**
     * Release a note on the preview synth
     */
    private releasePreviewNote(note: PianoRollNote): void {
        const noteId = `${note.pitch}-${note.onset}`
        if (!this.playingNotes.has(noteId)) return
        this.playingNotes.delete(noteId)

        const freq = Tone.Frequency(note.pitch, 'midi').toFrequency()

        switch (this.currentSynthType) {
            case 'sine':
                this.sineSynth?.triggerRelease(freq, Tone.now())
                break
            case 'synth':
                this.triangleSynth?.triggerRelease(freq, Tone.now())
                break
            case 'piano':
                this.pianoSynth?.triggerRelease(freq, Tone.now())
                break
        }
    }

    /**
     * Stop all preview notes
     */
    private stopAllPreviewNotes(): void {
        this.sineSynth?.releaseAll()
        this.triangleSynth?.releaseAll()
        this.pianoSynth?.releaseAll()
        this.playingNotes.clear()
    }

    /**
     * Get color for a note based on color mode
     */
    private getNoteColor(note: PianoRollNote): string {
        if (note.color) return note.color

        const opts = this.getOptions()

        switch (opts.colorMode) {
            case 'velocity': {
                // Interpolate from dark to bright based on velocity
                const v = note.velocity
                const r = Math.round(73 + v * 160)
                const g = Math.round(144 + v * 80)
                const b = Math.round(217 - v * 40)
                return `rgb(${r}, ${g}, ${b})`
            }
            case 'track':
                return opts.colorPalette[note.track % opts.colorPalette.length]
            case 'channel':
                return opts.colorPalette[note.channel % opts.colorPalette.length]
            case 'fixed':
            default:
                return opts.noteColor
        }
    }

    /**
     * Create the container and canvas elements
     */
    private createElements(): void {
        if (!this.wavesurfer) return

        const opts = this.getOptions()
        const wavesurferWrapper = this.wavesurfer.getWrapper()

        // Initialize FFT size from options
        this.currentFftSize = opts.fftSamples

        // Create container for piano roll - append to wavesurfer wrapper like spectrogram does
        this.container = document.createElement('div')
        this.container.style.position = 'relative'
        this.container.style.height = `${opts.height}px`
        this.container.style.overflow = 'hidden'
        this.container.style.backgroundColor = opts.backgroundColor

        // Create spectrogram canvas (background layer, behind notes)
        if (opts.showSpectrogram) {
            this.spectrogramCanvas = document.createElement('canvas')
            this.spectrogramCanvas.style.position = 'absolute'
            this.spectrogramCanvas.style.top = '0'
            this.spectrogramCanvas.style.left = '0'
            this.spectrogramCanvas.style.opacity = String(opts.spectrogramOpacity)
            this.spectrogramCanvas.style.zIndex = '1'
            this.container.appendChild(this.spectrogramCanvas)
            this.spectrogramCtx = this.spectrogramCanvas.getContext('2d')
        }

        // Create notes canvas (full width, matching waveform)
        this.canvas = document.createElement('canvas')
        this.canvas.style.position = 'absolute'
        this.canvas.style.top = '0'
        this.canvas.style.left = '0'
        this.canvas.style.zIndex = '2'
        this.container.appendChild(this.canvas)

        // Create playhead (higher z-index than keyboard to overlay it)
        this.playhead = document.createElement('div')
        this.playhead.style.position = 'absolute'
        this.playhead.style.top = '0'
        this.playhead.style.width = `${opts.playheadWidth}px`
        this.playhead.style.height = '100%'
        this.playhead.style.backgroundColor = opts.playheadColor
        this.playhead.style.boxShadow = `0 0 10px ${opts.playheadColor}`
        this.playhead.style.pointerEvents = 'none'
        this.playhead.style.zIndex = '40'
        this.playhead.style.left = '0'
        this.container.appendChild(this.playhead)

        // Create keyboard canvas (overlaid on left, not affecting layout)
        if (opts.showKeyboard) {
            this.keyboardCanvas = document.createElement('canvas')
            this.keyboardCanvas.width = opts.keyboardWidth
            this.keyboardCanvas.height = opts.height
            this.keyboardCanvas.style.position = 'absolute'
            this.keyboardCanvas.style.top = '0'
            this.keyboardCanvas.style.left = '0'
            this.keyboardCanvas.style.zIndex = '30'
            this.keyboardCanvas.style.pointerEvents = 'none'
            this.container.appendChild(this.keyboardCanvas)

            this.keyboardCtx = this.keyboardCanvas.getContext('2d')
        }

        this.ctx = this.canvas.getContext('2d')

        // Create controls container (for fold button)
        if (opts.showFoldButton) {
            this.controlsContainer = document.createElement('div')
            this.controlsContainer.style.position = 'absolute'
            this.controlsContainer.style.top = '4px'
            this.controlsContainer.style.right = '4px'
            this.controlsContainer.style.zIndex = '50'
            this.controlsContainer.style.display = 'flex'
            this.controlsContainer.style.gap = '4px'

            // Prevent clicks on controls from triggering canvas events
            this.controlsContainer.addEventListener('mousedown', (e) => e.stopPropagation())
            this.controlsContainer.addEventListener('dblclick', (e) => e.stopPropagation())

            this.foldButton = document.createElement('button')
            this.foldButton.textContent = 'Fold'
            this.foldButton.style.padding = '4px 8px'
            this.foldButton.style.fontSize = '11px'
            this.foldButton.style.fontWeight = '500'
            this.foldButton.style.border = 'none'
            this.foldButton.style.borderRadius = '4px'
            this.foldButton.style.backgroundColor = '#333'
            this.foldButton.style.color = '#fff'
            this.foldButton.style.cursor = 'pointer'
            this.foldButton.style.transition = 'background-color 0.15s'
            this.foldButton.addEventListener('click', (e) => {
                e.stopPropagation()
                e.preventDefault()
                this.toggleFold()
            })
            this.foldButton.addEventListener('mouseenter', () => {
                if (this.foldButton) {
                    this.foldButton.style.backgroundColor = this.isFolded ? '#5ee0b4' : '#444'
                }
            })
            this.foldButton.addEventListener('mouseleave', () => {
                this.updateFoldButton()
            })

            this.controlsContainer.appendChild(this.foldButton)

            // Create preview button (headphones icon)
            this.previewButton = document.createElement('button')
            this.previewButton.innerHTML = '&#x1F3A7;' // Headphones emoji
            this.previewButton.title = 'Preview MIDI notes'
            this.previewButton.style.padding = '4px 8px'
            this.previewButton.style.fontSize = '11px'
            this.previewButton.style.fontWeight = '500'
            this.previewButton.style.border = 'none'
            this.previewButton.style.borderRadius = '4px'
            this.previewButton.style.backgroundColor = '#333'
            this.previewButton.style.color = '#fff'
            this.previewButton.style.cursor = 'pointer'
            this.previewButton.style.transition = 'background-color 0.15s'
            this.previewButton.addEventListener('click', (e) => {
                e.stopPropagation()
                e.preventDefault()
                this.togglePreview()
            })
            this.previewButton.addEventListener('mouseenter', () => {
                if (this.previewButton) {
                    this.previewButton.style.backgroundColor = this.previewEnabled ? '#5ee0b4' : '#444'
                }
            })
            this.previewButton.addEventListener('mouseleave', () => {
                this.updatePreviewButton()
            })
            this.controlsContainer.appendChild(this.previewButton)

            // Create synth type selector
            this.synthTypeSelect = document.createElement('select')
            this.synthTypeSelect.title = 'Select synth type'
            this.synthTypeSelect.style.padding = '4px 6px'
            this.synthTypeSelect.style.fontSize = '11px'
            this.synthTypeSelect.style.border = 'none'
            this.synthTypeSelect.style.borderRadius = '4px'
            this.synthTypeSelect.style.backgroundColor = '#333'
            this.synthTypeSelect.style.color = '#fff'
            this.synthTypeSelect.style.cursor = 'pointer'
            this.synthTypeSelect.innerHTML = `
                <option value="sine">Sine</option>
                <option value="synth" selected>Synth</option>
                <option value="piano">Piano</option>
            `
            this.synthTypeSelect.addEventListener('change', (e) => {
                e.stopPropagation()
                this.setSynthType((e.target as HTMLSelectElement).value as PreviewSynthType)
            })
            this.synthTypeSelect.addEventListener('click', (e) => e.stopPropagation())
            this.controlsContainer.appendChild(this.synthTypeSelect)

            // Add export buttons
            const exportMidiBtn = document.createElement('button')
            exportMidiBtn.textContent = 'MIDI'
            exportMidiBtn.title = 'Export notes as MIDI file'
            exportMidiBtn.style.padding = '4px 8px'
            exportMidiBtn.style.fontSize = '11px'
            exportMidiBtn.style.fontWeight = '500'
            exportMidiBtn.style.border = 'none'
            exportMidiBtn.style.borderRadius = '4px'
            exportMidiBtn.style.backgroundColor = '#333'
            exportMidiBtn.style.color = '#fff'
            exportMidiBtn.style.cursor = 'pointer'
            exportMidiBtn.style.transition = 'background-color 0.15s'
            exportMidiBtn.addEventListener('click', (e) => {
                e.stopPropagation()
                e.preventDefault()
                this.exportMidi()
            })
            exportMidiBtn.addEventListener('mouseenter', () => {
                exportMidiBtn.style.backgroundColor = '#444'
            })
            exportMidiBtn.addEventListener('mouseleave', () => {
                exportMidiBtn.style.backgroundColor = '#333'
            })
            this.controlsContainer.appendChild(exportMidiBtn)

            const exportJsonBtn = document.createElement('button')
            exportJsonBtn.textContent = 'JSON'
            exportJsonBtn.title = 'Export notes as JSON file'
            exportJsonBtn.style.padding = '4px 8px'
            exportJsonBtn.style.fontSize = '11px'
            exportJsonBtn.style.fontWeight = '500'
            exportJsonBtn.style.border = 'none'
            exportJsonBtn.style.borderRadius = '4px'
            exportJsonBtn.style.backgroundColor = '#333'
            exportJsonBtn.style.color = '#fff'
            exportJsonBtn.style.cursor = 'pointer'
            exportJsonBtn.style.transition = 'background-color 0.15s'
            exportJsonBtn.addEventListener('click', (e) => {
                e.stopPropagation()
                e.preventDefault()
                this.exportJSON()
            })
            exportJsonBtn.addEventListener('mouseenter', () => {
                exportJsonBtn.style.backgroundColor = '#444'
            })
            exportJsonBtn.addEventListener('mouseleave', () => {
                exportJsonBtn.style.backgroundColor = '#333'
            })
            this.controlsContainer.appendChild(exportJsonBtn)

            // Add FFT size selector if spectrogram is enabled
            if (opts.showSpectrogram) {
                this.fftSelect = document.createElement('select')
                this.fftSelect.title = 'FFT size for spectrogram'
                this.fftSelect.style.padding = '4px 6px'
                this.fftSelect.style.fontSize = '11px'
                this.fftSelect.style.border = 'none'
                this.fftSelect.style.borderRadius = '4px'
                this.fftSelect.style.backgroundColor = '#333'
                this.fftSelect.style.color = '#fff'
                this.fftSelect.style.cursor = 'pointer'

                const fftSizes = [256, 512, 1024, 2048, 4096, 8192]
                this.fftSelect.innerHTML = fftSizes.map(size =>
                    `<option value="${size}" ${size === this.currentFftSize ? 'selected' : ''}>FFT ${size}</option>`
                ).join('')

                this.fftSelect.addEventListener('change', (e) => {
                    e.stopPropagation()
                    const size = parseInt((e.target as HTMLSelectElement).value, 10)
                    this.setFftSize(size)
                })
                this.fftSelect.addEventListener('click', (e) => e.stopPropagation())
                this.controlsContainer.appendChild(this.fftSelect)

                // Add snap to spectrogram checkbox
                const snapLabel = document.createElement('label')
                snapLabel.style.display = 'flex'
                snapLabel.style.alignItems = 'center'
                snapLabel.style.gap = '4px'
                snapLabel.style.padding = '4px 8px'
                snapLabel.style.fontSize = '11px'
                snapLabel.style.color = '#fff'
                snapLabel.style.cursor = 'pointer'
                snapLabel.style.backgroundColor = '#333'
                snapLabel.style.borderRadius = '4px'
                snapLabel.title = 'Double-click snaps to bright spectrogram regions'

                this.snapCheckbox = document.createElement('input')
                this.snapCheckbox.type = 'checkbox'
                this.snapCheckbox.checked = opts.snapToSpectrogram
                this.snapEnabled = opts.snapToSpectrogram
                this.snapCheckbox.style.cursor = 'pointer'
                this.snapCheckbox.addEventListener('change', (e) => {
                    e.stopPropagation()
                    this.snapEnabled = (e.target as HTMLInputElement).checked
                })
                this.snapCheckbox.addEventListener('click', (e) => e.stopPropagation())

                const snapText = document.createElement('span')
                snapText.textContent = 'Snap'

                snapLabel.appendChild(this.snapCheckbox)
                snapLabel.appendChild(snapText)
                snapLabel.addEventListener('click', (e) => e.stopPropagation())
                this.controlsContainer.appendChild(snapLabel)
            }

            this.container.appendChild(this.controlsContainer)
        }

        // Create tooltip for note hover
        this.tooltip = document.createElement('div')
        this.tooltip.style.position = 'absolute'
        this.tooltip.style.padding = '4px 8px'
        this.tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.85)'
        this.tooltip.style.color = '#fff'
        this.tooltip.style.fontSize = '12px'
        this.tooltip.style.fontFamily = 'monospace'
        this.tooltip.style.borderRadius = '4px'
        this.tooltip.style.pointerEvents = 'none'
        this.tooltip.style.zIndex = '60'
        this.tooltip.style.display = 'none'
        this.tooltip.style.whiteSpace = 'nowrap'
        this.container.appendChild(this.tooltip)

        // Add mouse event listeners for hover and editing
        this.container.addEventListener('mousemove', this.onMouseMove)
        this.container.addEventListener('mouseleave', this.onMouseLeave)
        this.container.addEventListener('mousedown', this.onMouseDown)
        this.container.addEventListener('dblclick', this.onDoubleClick)

        // Insert container inside wavesurfer wrapper (like spectrogram does)
        wavesurferWrapper.appendChild(this.container)

        // Initialize fold state
        this.isFolded = opts.foldedByDefault
        this.updateFoldButton()
    }

    /**
     * Resize the canvas to match waveform dimensions
     */
    private resizeCanvas(): void {
        if (!this.canvas || !this.wavesurfer || !this.ctx) return

        const opts = this.getOptions()
        const wrapper = this.wavesurfer.getWrapper()
        const dpr = window.devicePixelRatio || 1

        const displayWidth = wrapper.scrollWidth
        const displayHeight = opts.height

        // Set canvas size in pixels (scaled for DPI)
        this.canvas.width = displayWidth * dpr
        this.canvas.height = displayHeight * dpr

        // Set display size via CSS
        this.canvas.style.width = `${displayWidth}px`
        this.canvas.style.height = `${displayHeight}px`

        // Scale context to match DPR
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        // Resize spectrogram canvas (no DPR scaling - uses ImageData directly)
        // The bilinear interpolation provides smoothness instead of DPR scaling
        if (this.spectrogramCanvas) {
            this.spectrogramCanvas.width = displayWidth
            this.spectrogramCanvas.height = displayHeight
            this.spectrogramCanvas.style.width = `${displayWidth}px`
            this.spectrogramCanvas.style.height = `${displayHeight}px`
        }
    }

    /**
     * Render the piano roll
     */
    private render(): void {
        this.resizeCanvas()
        this.renderSpectrogram()
        this.renderGrid()
        this.renderNotes()
        this.renderKeyboard()
    }

    /**
     * Render grid lines
     */
    private renderGrid(): void {
        if (!this.ctx || !this.canvas || !this.wavesurfer) return

        const opts = this.getOptions()
        const ctx = this.ctx
        const wrapper = this.wavesurfer.getWrapper()
        // Use display dimensions (not canvas pixel dimensions which are DPR-scaled)
        const width = wrapper.scrollWidth
        const height = this.getDisplayHeight()
        const duration = this.wavesurfer.getDuration()

        // Clear the canvas first (transparent background to show spectrogram)
        ctx.clearRect(0, 0, width, height)

        // If no spectrogram, fill with background color
        if (!opts.showSpectrogram) {
            ctx.fillStyle = opts.backgroundColor
            ctx.fillRect(0, 0, width, height)
        }

        if (!opts.showGrid) return

        // Use more subtle grid when spectrogram is visible
        ctx.strokeStyle = opts.showSpectrogram ? 'rgba(255,255,255,0.1)' : opts.gridColor
        ctx.lineWidth = 1

        // Draw horizontal pitch lines using display pitches (respects fold state)
        const pitches = this.getDisplayPitches()
        const noteHeight = height / pitches.length

        // Draw from top (high pitch) to bottom (low pitch)
        for (let i = 0; i < pitches.length; i++) {
            const pitch = pitches[pitches.length - 1 - i] // Reversed order
            const y = i * noteHeight

            // Darker background for black keys (only when no spectrogram)
            if (!opts.showSpectrogram && isBlackKey(pitch)) {
                ctx.fillStyle = 'rgba(0,0,0,0.2)'
                ctx.fillRect(0, y, width, noteHeight)
            }

            ctx.beginPath()
            ctx.moveTo(0, y + noteHeight)
            ctx.lineTo(width, y + noteHeight)
            ctx.stroke()
        }

        // Draw vertical time lines (every second)
        if (duration > 0) {
            const pxPerSecond = width / duration
            const interval = pxPerSecond > 100 ? 0.5 : pxPerSecond > 50 ? 1 : pxPerSecond > 20 ? 2 : 5

            for (let t = 0; t <= duration; t += interval) {
                const x = this.timeToPx(t)
                const isWhole = t % 1 === 0

                // Use more subtle grid when spectrogram is visible
                if (opts.showSpectrogram) {
                    ctx.strokeStyle = isWhole ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)'
                } else {
                    ctx.strokeStyle = isWhole ? 'rgba(128,128,128,0.3)' : opts.gridColor
                }
                ctx.lineWidth = isWhole ? 1 : 0.5

                ctx.beginPath()
                ctx.moveTo(x, 0)
                ctx.lineTo(x, height)
                ctx.stroke()
            }
        }
    }

    /**
     * Render all notes
     */
    private renderNotes(): void {
        if (!this.ctx || !this.canvas) return

        const ctx = this.ctx
        const opts = this.getOptions()
        const noteHeight = this.getNoteHeight()

        // Draw ghost of original position if dragging
        if (this.dragState) {
            const { originalNote, note, multiDrag } = this.dragState

            if (multiDrag) {
                // Multi-drag: draw ghosts for all selected notes
                for (let i = 0; i < multiDrag.notes.length; i++) {
                    const n = multiDrag.notes[i]
                    const orig = multiDrag.originals[i]

                    const hasChanged =
                        n.onset !== orig.onset ||
                        n.offset !== orig.offset ||
                        n.pitch !== orig.pitch

                    if (hasChanged) {
                        const gx = this.timeToPx(orig.onset)
                        const gw = Math.max(this.timeToPx(orig.offset) - gx, 2)
                        const gy = this.pitchToPx(orig.pitch)
                        const gh = noteHeight - 1

                        ctx.save()
                        ctx.globalAlpha = 0.3
                        ctx.fillStyle = this.getNoteColor(orig)
                        ctx.beginPath()
                        ctx.roundRect(gx, gy, gw, gh, opts.noteRadius)
                        ctx.fill()

                        ctx.setLineDash([4, 4])
                        ctx.strokeStyle = '#ffffff'
                        ctx.lineWidth = 1
                        ctx.stroke()
                        ctx.restore()
                    }
                }
            } else {
                // Single note ghost
                const hasChanged =
                    note.onset !== originalNote.onset ||
                    note.offset !== originalNote.offset ||
                    note.pitch !== originalNote.pitch

                if (hasChanged) {
                    const gx = this.timeToPx(originalNote.onset)
                    const gw = Math.max(this.timeToPx(originalNote.offset) - gx, 2)
                    const gy = this.pitchToPx(originalNote.pitch)
                    const gh = noteHeight - 1

                    // Draw ghost rectangle (semi-transparent, dashed border)
                    ctx.save()
                    ctx.globalAlpha = 0.3
                    ctx.fillStyle = this.getNoteColor(originalNote)
                    ctx.beginPath()
                    ctx.roundRect(gx, gy, gw, gh, opts.noteRadius)
                    ctx.fill()

                    ctx.setLineDash([4, 4])
                    ctx.strokeStyle = '#ffffff'
                    ctx.lineWidth = 1
                    ctx.stroke()
                    ctx.restore()
                }
            }
        }

        for (const note of this.notes) {
            // Skip notes outside visible pitch range
            if (note.pitch < this.minPitch || note.pitch > this.maxPitch) continue

            const x = this.timeToPx(note.onset)
            const w = Math.max(this.timeToPx(note.offset) - x, 2)
            const y = this.pitchToPx(note.pitch)
            const h = noteHeight - 1

            const isActive = this.activeNotes.has(note)
            const isDragging = this.dragState?.note === note
            const isSelected = this.selectedNotes.has(note)

            // Draw glow for active, dragged, or selected notes
            if ((isActive && opts.activeNoteGlow) || isDragging || isSelected) {
                ctx.save()
                ctx.shadowColor = isDragging ? '#00ffff' : isSelected ? '#ffff00' : opts.activeNoteColor
                ctx.shadowBlur = isDragging ? 20 : isSelected ? 12 : 15
                ctx.fillStyle = isDragging ? '#00ffff' : isSelected ? '#ffff00' : opts.activeNoteColor
                ctx.beginPath()
                ctx.roundRect(x, y, w, h, opts.noteRadius)
                ctx.fill()
                ctx.restore()
            }

            // Draw note rectangle
            let fillColor = this.getNoteColor(note)
            if (isActive) {
                fillColor = opts.activeNoteColor
            } else if (isDragging) {
                // Slightly brighter color when dragging
                fillColor = '#00dddd'
            } else if (isSelected) {
                // Tint selected notes yellow
                fillColor = '#ffcc00'
            }

            ctx.fillStyle = fillColor
            ctx.beginPath()
            ctx.roundRect(x, y, w, h, opts.noteRadius)
            ctx.fill()

            // Draw border
            if (opts.noteBorderWidth > 0) {
                ctx.strokeStyle = isActive ? opts.activeNoteColor : isDragging ? '#00ffff' : isSelected ? '#ffff00' : opts.noteBorderColor
                ctx.lineWidth = (isActive || isDragging || isSelected) ? 2 : opts.noteBorderWidth
                ctx.stroke()
            }
        }

        // Draw selection box if active
        this.renderSelectionBox()
    }

    /**
     * Render the selection box during drag
     */
    private renderSelectionBox(): void {
        if (!this.selectionBox || !this.ctx) return

        const ctx = this.ctx
        const box = this.selectionBox

        const x = Math.min(box.startX, box.endX)
        const y = Math.min(box.startY, box.endY)
        const w = Math.abs(box.endX - box.startX)
        const h = Math.abs(box.endY - box.startY)

        // Draw semi-transparent fill
        ctx.save()
        ctx.fillStyle = 'rgba(255, 255, 0, 0.1)'
        ctx.fillRect(x, y, w, h)

        // Draw dashed border
        ctx.setLineDash([4, 4])
        ctx.strokeStyle = '#ffff00'
        ctx.lineWidth = 1
        ctx.strokeRect(x, y, w, h)
        ctx.restore()
    }

    /**
     * Render the piano keyboard
     */
    private renderKeyboard(): void {
        if (!this.keyboardCtx || !this.keyboardCanvas) return

        const ctx = this.keyboardCtx
        const opts = this.getOptions()
        const width = this.keyboardCanvas.width
        const height = this.keyboardCanvas.height

        // Clear
        ctx.fillStyle = '#0a0a15'
        ctx.fillRect(0, 0, width, height)

        // Build set of active pitches for quick lookup
        const activePitches = new Set<number>()
        for (const note of this.activeNotes) {
            activePitches.add(note.pitch)
        }

        // Use display pitches (respects fold state)
        const pitches = this.getDisplayPitches()
        const noteHeight = height / pitches.length

        // Draw keys from top (high pitch) to bottom (low pitch)
        for (let i = 0; i < pitches.length; i++) {
            const pitch = pitches[pitches.length - 1 - i] // Reversed order
            const y = i * noteHeight
            const isBlack = isBlackKey(pitch)
            const isActive = activePitches.has(pitch)

            if (isActive) {
                // Active key - use playhead color (red)
                ctx.fillStyle = opts.playheadColor
                ctx.fillRect(0, y, width, noteHeight - 1)
            } else if (isBlack) {
                // Black key
                ctx.fillStyle = '#1a1a1a'
                ctx.fillRect(0, y, width * 0.6, noteHeight - 1)
            } else {
                // White key
                ctx.fillStyle = '#e8e8e8'
                ctx.fillRect(0, y, width - 1, noteHeight - 1)
            }

            // Draw note name for C notes or when folded (show all note names)
            const showLabel = this.isFolded || pitch % 12 === 0
            if (showLabel && noteHeight >= 10) {
                ctx.fillStyle = isActive ? '#fff' : (isBlack ? '#aaa' : '#333')
                ctx.font = `${Math.min(10, Math.max(8, noteHeight - 2))}px sans-serif`
                const labelX = isActive ? 2 : (isBlack ? width * 0.65 : 2)
                ctx.fillText(pitchToNoteName(pitch), labelX, y + noteHeight - 2)
            }

            // Draw separator line
            ctx.strokeStyle = '#333'
            ctx.lineWidth = 0.5
            ctx.beginPath()
            ctx.moveTo(0, y + noteHeight)
            ctx.lineTo(width, y + noteHeight)
            ctx.stroke()
        }
    }

    /**
     * Render the spectrogram background
     */
    private renderSpectrogram(): void {
        if (!this.spectrogramCtx || !this.spectrogramCanvas) return

        const opts = this.getOptions()
        const width = this.spectrogramCanvas.width
        const height = this.spectrogramCanvas.height

        // Clear and fill with background color first (ensures full opacity)
        this.spectrogramCtx.fillStyle = opts.backgroundColor
        this.spectrogramCtx.fillRect(0, 0, width, height)

        // If no spectrogram data yet, just show background
        if (this.spectrogramData.length === 0) return

        // Calculate frequency range from pitch range to align with piano roll
        // Add some padding (1 semitone below and above) for better visual alignment
        const pitches = this.getDisplayPitches()
        const minDisplayPitch = Math.min(...pitches)
        const maxDisplayPitch = Math.max(...pitches)

        // Convert MIDI pitch to Hz for spectrogram frequency range
        // Subtract 0.5 from min and add 0.5 to max to center notes in their frequency bands
        const frequencyMin = midiToHz(minDisplayPitch - 0.5)
        const frequencyMax = midiToHz(maxDisplayPitch + 0.5)

        // Render spectrogram to image data with pitch-aligned frequency range
        // Use currentFftSize which may have been changed by the user
        const imageData = renderSpectrogramToImageData(
            this.spectrogramData,
            width,
            height,
            this.audioSampleRate,
            this.currentFftSize,
            frequencyMin,
            frequencyMax,
            opts.spectrogramColorMap as ColorMapType
        )

        // Draw to canvas
        this.spectrogramCtx.putImageData(imageData, 0, 0)
    }

    /**
     * Calculate spectrogram from audio buffer
     */
    private calculateSpectrogramData(audioBuffer: AudioBuffer): void {
        const opts = this.getOptions()
        if (!opts.showSpectrogram) return

        // Cache audio buffer for FFT size changes
        this.cachedAudioBuffer = audioBuffer
        this.audioSampleRate = audioBuffer.sampleRate

        // Get mono audio data (mix channels if stereo)
        let audioData: Float32Array
        if (audioBuffer.numberOfChannels === 1) {
            audioData = audioBuffer.getChannelData(0)
        } else {
            // Mix to mono
            const left = audioBuffer.getChannelData(0)
            const right = audioBuffer.getChannelData(1)
            audioData = new Float32Array(left.length)
            for (let i = 0; i < left.length; i++) {
                audioData[i] = (left[i] + right[i]) / 2
            }
        }

        // Calculate spectrogram using current FFT size and overlap
        const fftSize = this.currentFftSize
        // Clamp overlap to valid range (0-0.95)
        const overlap = Math.max(0, Math.min(0.95, opts.spectrogramOverlap))
        const hopSize = Math.max(1, Math.floor(fftSize * (1 - overlap)))
        this.spectrogramData = calculateSpectrogram(
            audioData,
            this.audioSampleRate,
            fftSize,
            hopSize
        )

        // Re-render to show spectrogram
        this.render()
    }

    /**
     * Sync scroll position with waveform
     * Note: Since we're now inside the wrapper, scrolling is automatic.
     * We just need to update the playhead position.
     */
    private syncScroll(): void {
        if (!this.wavesurfer || !this.canvas) return

        // Update playhead position when scrolling
        this.updatePlayhead()
    }

    /**
     * Handle zoom event
     */
    private onZoom = (): void => {
        this.render()
        // Update playhead after zoom since canvas width changed
        this.updatePlayhead()
    }

    /**
     * Handle scroll event
     */
    private onScroll = (): void => {
        this.syncScroll()
    }

    /**
     * Handle redraw event
     */
    private onRedraw = (): void => {
        this.render()
    }

    /**
     * Handle time update event (during playback)
     */
    private onTimeUpdate = (time: number): void => {
        this.currentTime = time

        // Update playhead position
        this.updatePlayhead()

        // Update active notes
        this.updateActiveNotes()
    }

    /**
     * Handle mouse move for note hover
     */
    private onMouseMove = (event: MouseEvent): void => {
        if (!this.container || !this.wavesurfer) return

        // Don't update hover state during drag
        if (this.dragState) return

        const rect = this.container.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top

        // Since container is inside the scrolling wrapper, getBoundingClientRect
        // already accounts for scroll position - x is the absolute position
        const note = this.findNoteAtPosition(x, y)

        // Update cursor based on hover position and modifier keys
        this.updateCursor(x, note, event.shiftKey)

        if (note !== this.hoveredNote) {
            this.hoveredNote = note
            this.updateTooltip(x, y)
            this.emit('notehover', note, event)
        } else if (note && this.tooltip) {
            // Update tooltip position even if same note
            this.updateTooltipPosition(x, y)
        }
    }

    /**
     * Handle mouse leave
     */
    private onMouseLeave = (): void => {
        this.hoveredNote = null
        if (this.tooltip) {
            this.tooltip.style.display = 'none'
        }
        // Reset cursor when leaving
        if (this.container && !this.dragState) {
            this.container.style.cursor = 'default'
        }
    }

    /**
     * Determine drag mode based on click position relative to note
     */
    private getDragMode(x: number, note: PianoRollNote): 'move' | 'resize-left' | 'resize-right' {
        const noteX = this.timeToPx(note.onset)
        const noteW = Math.max(this.timeToPx(note.offset) - noteX, 2)

        // Check if near left edge
        if (x - noteX < this.EDGE_THRESHOLD) {
            return 'resize-left'
        }
        // Check if near right edge
        if (noteX + noteW - x < this.EDGE_THRESHOLD) {
            return 'resize-right'
        }
        return 'move'
    }

    /**
     * Handle mouse down for note dragging, deletion, or box selection
     */
    private onMouseDown = (event: MouseEvent): void => {
        if (!this.container) return

        const rect = this.container.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top

        const note = this.findNoteAtPosition(x, y)

        // If clicking on empty space, start box selection
        if (!note) {
            event.preventDefault()

            // Clear existing selection unless shift is held
            if (!event.shiftKey) {
                this.selectedNotes.clear()
                this.emit('selectionchange', [])
            }

            // Start box selection
            this.selectionBox = {
                startX: x,
                startY: y,
                endX: x,
                endY: y,
                active: true,
            }

            this.container.style.cursor = 'crosshair'

            // Add document-level listeners for selection
            document.addEventListener('mousemove', this.onSelectionDrag)
            document.addEventListener('mouseup', this.onSelectionEnd)
            return
        }

        // Shift+click to delete note
        if (event.shiftKey) {
            event.preventDefault()
            this.deleteNote(note)
            return
        }

        // Prevent text selection during drag
        event.preventDefault()

        const noteX = this.timeToPx(note.onset)
        const noteY = this.pitchToPx(note.pitch)
        const mode = this.getDragMode(x, note)

        // Deep copy the original note for comparison/undo
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

        // If dragging a selected note in move mode, prepare multi-drag
        if (mode === 'move' && this.selectedNotes.has(note) && this.selectedNotes.size > 1) {
            const notes = Array.from(this.selectedNotes)
            const originals = notes.map(n => ({ ...n }))
            this.dragState.multiDrag = { notes, originals }
        }

        // Update cursor
        if (mode === 'move') {
            this.container.style.cursor = 'grabbing'
        } else {
            this.container.style.cursor = 'ew-resize'
        }

        // Hide tooltip during drag
        if (this.tooltip) {
            this.tooltip.style.display = 'none'
        }

        // Add document-level listeners for drag
        document.addEventListener('mousemove', this.onDragMove)
        document.addEventListener('mouseup', this.onDragEnd)
    }

    /**
     * Handle mouse move during drag operation
     */
    private onDragMove = (event: MouseEvent): void => {
        if (!this.dragState || !this.container || !this.wavesurfer) return

        const rect = this.container.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top

        const { note, originalNote, mode, offsetX, multiDrag } = this.dragState
        const duration = this.wavesurfer.getDuration()

        if (mode === 'move') {
            // Calculate delta from original position
            const deltaTime = this.pxToTime(x - offsetX) - originalNote.onset
            const newPitch = this.pxToPitch(y)
            const deltaPitch = newPitch - originalNote.pitch

            if (multiDrag) {
                // Multi-select drag: move all selected notes
                for (let i = 0; i < multiDrag.notes.length; i++) {
                    const n = multiDrag.notes[i]
                    const orig = multiDrag.originals[i]
                    const noteDuration = orig.duration

                    // Calculate new onset
                    let newOnset = orig.onset + deltaTime
                    newOnset = Math.max(0, Math.min(duration - noteDuration, newOnset))

                    n.onset = newOnset
                    n.offset = newOnset + noteDuration

                    // Apply pitch delta
                    const targetPitch = clampPitch(orig.pitch + deltaPitch)
                    if (n.pitch !== targetPitch) {
                        n.pitch = targetPitch
                        n.name = pitchToNoteName(targetPitch)
                    }
                }

                // Preview pitch change for primary note if enabled
                if (this.previewEnabled && newPitch !== this.dragState.lastPreviewPitch) {
                    this.previewDragPitch(newPitch)
                    this.dragState.lastPreviewPitch = newPitch
                }
            } else {
                // Single note drag
                const noteDuration = note.duration
                let newOnset = this.pxToTime(x - offsetX)

                // Clamp to valid range
                newOnset = Math.max(0, Math.min(duration - noteDuration, newOnset))

                // Update note
                note.onset = newOnset
                note.offset = newOnset + noteDuration

                if (note.pitch !== newPitch) {
                    note.pitch = newPitch
                    note.name = pitchToNoteName(newPitch)

                    // Preview pitch change if enabled
                    if (this.previewEnabled && newPitch !== this.dragState.lastPreviewPitch) {
                        this.previewDragPitch(newPitch)
                        this.dragState.lastPreviewPitch = newPitch
                    }
                }
            }
        } else if (mode === 'resize-left') {
            // Resize from left edge - changes onset
            let newOnset = this.pxToTime(x)
            const minOnset = 0
            const maxOnset = note.offset - this.MIN_NOTE_DURATION

            newOnset = Math.max(minOnset, Math.min(maxOnset, newOnset))

            note.onset = newOnset
            note.duration = note.offset - note.onset
        } else if (mode === 'resize-right') {
            // Resize from right edge - changes offset
            let newOffset = this.pxToTime(x)
            const minOffset = note.onset + this.MIN_NOTE_DURATION
            const maxOffset = duration

            newOffset = Math.max(minOffset, Math.min(maxOffset, newOffset))

            note.offset = newOffset
            note.duration = note.offset - note.onset
        }

        // Re-render to show changes
        this.render()
    }

    /**
     * Preview pitch during drag operation
     */
    private previewDragPitch(pitch: number): void {
        if (!this.previewEnabled) return

        // Create a temporary note for preview
        const previewNote: PianoRollNote = {
            pitch,
            name: pitchToNoteName(pitch),
            onset: 0,
            offset: 0.3,
            duration: 0.3,
            velocity: 0.7,
            track: 0,
            channel: 0,
        }

        // Stop any previous preview
        this.stopAllPreviewNotes()

        // Trigger the preview
        this.triggerPreviewNote(previewNote)

        // Auto-release after short duration
        setTimeout(() => {
            this.releasePreviewNote(previewNote)
        }, 200)
    }

    /**
     * Handle mouse up to end drag operation
     */
    private onDragEnd = (): void => {
        if (!this.dragState || !this.container) return

        const { note, originalNote, mode, multiDrag } = this.dragState

        if (multiDrag && mode === 'move') {
            // Multi-drag: check all notes for changes
            let anyChanged = false
            for (let i = 0; i < multiDrag.notes.length; i++) {
                const n = multiDrag.notes[i]
                const orig = multiDrag.originals[i]

                const hasChanged =
                    n.onset !== orig.onset ||
                    n.offset !== orig.offset ||
                    n.pitch !== orig.pitch

                if (hasChanged) {
                    anyChanged = true
                    this.emit('notedrag', n, orig)
                }
            }

            if (anyChanged) {
                this.emit('noteschange')
            }
        } else {
            // Single note drag
            const hasChanged =
                note.onset !== originalNote.onset ||
                note.offset !== originalNote.offset ||
                note.pitch !== originalNote.pitch

            if (hasChanged) {
                // Emit appropriate event
                if (mode === 'move') {
                    this.emit('notedrag', note, originalNote)
                } else {
                    this.emit('noteresize', note, originalNote)
                }
                this.emit('noteschange')
            }
        }

        // Reset cursor
        this.container.style.cursor = 'default'

        // Stop any pitch preview
        this.stopAllPreviewNotes()

        // Clear drag state
        this.dragState = null

        // Remove document-level listeners
        document.removeEventListener('mousemove', this.onDragMove)
        document.removeEventListener('mouseup', this.onDragEnd)

        // Re-render to finalize
        this.render()
    }

    /**
     * Handle mouse move during box selection
     */
    private onSelectionDrag = (event: MouseEvent): void => {
        if (!this.selectionBox || !this.container) return

        const rect = this.container.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top

        this.selectionBox.endX = x
        this.selectionBox.endY = y

        // Re-render to show selection box
        this.render()
    }

    /**
     * Handle mouse up to end box selection
     */
    private onSelectionEnd = (): void => {
        if (!this.selectionBox || !this.container) return

        // Find all notes within the selection box
        const box = this.selectionBox
        const minX = Math.min(box.startX, box.endX)
        const maxX = Math.max(box.startX, box.endX)
        const minY = Math.min(box.startY, box.endY)
        const maxY = Math.max(box.startY, box.endY)

        const noteHeight = this.getNoteHeight()

        for (const note of this.notes) {
            // Skip notes outside visible pitch range
            if (note.pitch < this.minPitch || note.pitch > this.maxPitch) continue
            if (this.isFolded && !this.usedPitches.includes(note.pitch)) continue

            const noteX = this.timeToPx(note.onset)
            const noteW = Math.max(this.timeToPx(note.offset) - noteX, 2)
            const noteY = this.pitchToPx(note.pitch)
            const noteH = noteHeight - 1

            // Check if note intersects with selection box
            const noteRight = noteX + noteW
            const noteBottom = noteY + noteH

            if (noteX <= maxX && noteRight >= minX && noteY <= maxY && noteBottom >= minY) {
                this.selectedNotes.add(note)
            }
        }

        // Emit selection change event
        this.emit('selectionchange', Array.from(this.selectedNotes))

        // Reset cursor
        this.container.style.cursor = 'default'

        // Clear selection box state
        this.selectionBox = null

        // Remove document-level listeners
        document.removeEventListener('mousemove', this.onSelectionDrag)
        document.removeEventListener('mouseup', this.onSelectionEnd)

        // Re-render to show selected notes
        this.render()
    }

    /**
     * Update cursor based on hover position over notes
     */
    private updateCursor(x: number, note: PianoRollNote | null, shiftKey = false): void {
        if (!this.container || this.dragState) return

        if (!note) {
            this.container.style.cursor = 'default'
            return
        }

        // Shift+hover shows delete cursor
        if (shiftKey) {
            this.container.style.cursor = 'not-allowed'
            return
        }

        const mode = this.getDragMode(x, note)
        if (mode === 'move') {
            this.container.style.cursor = 'grab'
        } else {
            this.container.style.cursor = 'ew-resize'
        }
    }

    /**
     * Delete a note from the piano roll
     */
    private deleteNote(note: PianoRollNote): void {
        const index = this.notes.indexOf(note)
        if (index === -1) return

        // Remove from array
        this.notes.splice(index, 1)

        // Update used pitches for fold mode
        this.updateUsedPitches()

        // Re-render
        this.render()

        // Emit events
        this.emit('notedelete', note)
        this.emit('noteschange')
    }

    /**
     * Detect a note from spectrogram peaks at the given position
     * Returns { pitch, onset, offset } or null if no peak detected
     */
    private detectSpectrogramNote(x: number, y: number): { pitch: number; onset: number; offset: number } | null {
        if (!this.wavesurfer || this.spectrogramData.length === 0) return null

        const wrapper = this.wavesurfer.getWrapper()
        const duration = this.wavesurfer.getDuration()
        const displayWidth = wrapper.scrollWidth

        // Get the pitch at click position
        const clickPitch = this.pxToPitch(y)

        // Convert pitch to frequency
        const clickFreq = midiToHz(clickPitch)

        // Convert frequency to FFT bin
        const binFloat = (clickFreq / this.audioSampleRate) * this.currentFftSize
        const bin = Math.round(binFloat)

        if (bin < 0 || bin >= this.currentFftSize / 2) return null

        // Get frame index from x position
        const frameFloat = (x / displayWidth) * (this.spectrogramData.length - 1)
        const frameIndex = Math.round(frameFloat)

        if (frameIndex < 0 || frameIndex >= this.spectrogramData.length) return null

        // Check if there's significant energy at this bin
        const frame = this.spectrogramData[frameIndex]
        const magnitude = frame[bin] || 0

        // Find max magnitude in this frame for threshold
        let maxMag = 0
        for (let i = 0; i < frame.length; i++) {
            if (frame[i] > maxMag) maxMag = frame[i]
        }

        // If the clicked bin is below 20% of max, don't snap
        if (magnitude < maxMag * 0.2) return null

        // Threshold for detecting note presence (20% of magnitude at click point)
        const threshold = magnitude * 0.2

        // Search for the actual peak near the clicked bin (within 2 semitones)
        const searchRadius = Math.round((clickFreq * 0.12) / this.audioSampleRate * this.currentFftSize) // ~2 semitones
        let peakBin = bin
        let peakMag = magnitude
        for (let b = Math.max(0, bin - searchRadius); b <= Math.min(frame.length - 1, bin + searchRadius); b++) {
            if (frame[b] > peakMag) {
                peakMag = frame[b]
                peakBin = b
            }
        }

        // Convert peak bin back to pitch
        const peakFreq = (peakBin * this.audioSampleRate) / this.currentFftSize
        const detectedPitch = clampPitch(Math.round(69 + 12 * Math.log2(peakFreq / 440)))

        // Search backward to find onset
        let onsetFrame = frameIndex
        for (let f = frameIndex - 1; f >= 0; f--) {
            const binMag = this.spectrogramData[f][peakBin] || 0
            if (binMag < threshold) {
                onsetFrame = f + 1
                break
            }
            onsetFrame = f
        }

        // Search forward to find offset
        let offsetFrame = frameIndex
        for (let f = frameIndex + 1; f < this.spectrogramData.length; f++) {
            const binMag = this.spectrogramData[f][peakBin] || 0
            if (binMag < threshold) {
                offsetFrame = f - 1
                break
            }
            offsetFrame = f
        }

        // Convert frame indices to time
        const onset = (onsetFrame / (this.spectrogramData.length - 1)) * duration
        const offset = Math.min(((offsetFrame + 1) / (this.spectrogramData.length - 1)) * duration, duration)

        // Ensure minimum duration
        if (offset - onset < this.MIN_NOTE_DURATION) {
            return {
                pitch: detectedPitch,
                onset,
                offset: onset + 0.25, // Default duration
            }
        }

        return { pitch: detectedPitch, onset, offset }
    }

    /**
     * Handle double-click to create new note
     */
    private onDoubleClick = (event: MouseEvent): void => {
        if (!this.container || !this.wavesurfer) return

        const rect = this.container.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top

        // Check if clicking on existing note - don't create new one
        const existingNote = this.findNoteAtPosition(x, y)
        if (existingNote) return

        let pitch: number
        let onset: number
        let offset: number

        // Try to snap to spectrogram if enabled
        if (this.snapEnabled && this.spectrogramData.length > 0) {
            const detected = this.detectSpectrogramNote(x, y)
            if (detected) {
                pitch = detected.pitch
                onset = detected.onset
                offset = detected.offset
            } else {
                // No peak detected, fall back to regular behavior
                onset = this.pxToTime(x)
                pitch = this.pxToPitch(y)
                const defaultDuration = 0.25
                const duration = this.wavesurfer.getDuration()
                offset = Math.min(onset + defaultDuration, duration)
            }
        } else {
            // Regular behavior: click position determines note
            onset = this.pxToTime(x)
            pitch = this.pxToPitch(y)
            const defaultDuration = 0.25
            const duration = this.wavesurfer.getDuration()
            offset = Math.min(onset + defaultDuration, duration)
        }

        // Create new note
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

        // Add to notes array and sort
        this.notes.push(newNote)
        this.notes.sort((a, b) => a.onset - b.onset)

        // Update used pitches for fold mode
        this.updateUsedPitches()

        // Preview the new note if enabled
        if (this.previewEnabled) {
            this.triggerPreviewNote(newNote)
            setTimeout(() => this.releasePreviewNote(newNote), 200)
        }

        // Re-render
        this.render()

        // Emit events
        this.emit('notecreate', newNote)
        this.emit('noteschange')
    }

    /**
     * Find note at a given pixel position
     */
    private findNoteAtPosition(x: number, y: number): PianoRollNote | null {
        const noteHeight = this.getNoteHeight()

        for (const note of this.notes) {
            // Skip notes outside visible pitch range
            if (note.pitch < this.minPitch || note.pitch > this.maxPitch) continue
            // Skip notes not in folded view
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

    /**
     * Update tooltip content and position
     */
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

    /**
     * Update tooltip position
     */
    private updateTooltipPosition(x: number, y: number): void {
        if (!this.tooltip || !this.container) return

        const containerRect = this.container.getBoundingClientRect()
        const tooltipRect = this.tooltip.getBoundingClientRect()

        // Position tooltip above cursor, centered horizontally
        let tooltipX = x - tooltipRect.width / 2
        let tooltipY = y - tooltipRect.height - 8

        // Keep tooltip within container bounds
        if (tooltipX < 4) tooltipX = 4
        if (tooltipX + tooltipRect.width > containerRect.width - 4) {
            tooltipX = containerRect.width - tooltipRect.width - 4
        }
        if (tooltipY < 4) tooltipY = y + 20 // Show below if not enough space above

        this.tooltip.style.left = `${tooltipX}px`
        this.tooltip.style.top = `${tooltipY}px`
    }

    /**
     * Update playhead position
     */
    private updatePlayhead(): void {
        if (!this.playhead || !this.wavesurfer) return

        const x = this.timeToPx(this.currentTime)

        // Position playhead at absolute X - it scrolls with the content now
        this.playhead.style.left = `${x}px`
    }

    /**
     * Update which notes are currently active (being played)
     */
    private updateActiveNotes(): void {
        const previousActive = new Set(this.activeNotes)
        this.activeNotes.clear()

        for (const note of this.notes) {
            if (this.currentTime >= note.onset && this.currentTime < note.offset) {
                this.activeNotes.add(note)

                // Trigger note if it just became active
                if (!previousActive.has(note)) {
                    this.triggerPreviewNote(note)
                }
            }
        }

        // Release notes that are no longer active
        for (const note of previousActive) {
            if (!this.activeNotes.has(note)) {
                this.releasePreviewNote(note)
            }
        }

        // Only re-render if active notes changed
        if (this.activeNotes.size !== previousActive.size || this.activeNotes.size > 0) {
            this.render()
        }
    }

    /**
     * Auto-detect pitch range from loaded notes
     */
    private detectPitchRange(): void {
        if (this.notes.length === 0) {
            this.minPitch = this.options.minPitch ?? 21
            this.maxPitch = this.options.maxPitch ?? 108
            return
        }

        const pitches = this.notes.map(n => n.pitch)
        const minNote = Math.min(...pitches)
        const maxNote = Math.max(...pitches)

        // Add padding and round to octave boundaries for cleaner display
        this.minPitch = this.options.minPitch ?? Math.max(0, Math.floor((minNote - 2) / 12) * 12)
        this.maxPitch = this.options.maxPitch ?? Math.min(127, Math.ceil((maxNote + 2) / 12) * 12 + 11)
    }

    /**
     * Normalize a PianoRollNoteInput to PianoRollNote
     */
    private normalizeNote(input: PianoRollNoteInput, pitchIsHz = false): PianoRollNote {
        const pitch = clampPitch(toMidiPitch(input.pitch, pitchIsHz))
        const onset = input.onset
        const duration = input.duration ?? (input.offset ? input.offset - input.onset : 0.1)
        const offset = input.offset ?? onset + duration

        let velocity = input.velocity ?? 0.8
        // Normalize velocity if it's in 0-127 range
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

    /**
     * Load MIDI file from URL
     */
    public async loadMidi(url: string): Promise<void> {
        const response = await fetch(url)
        const arrayBuffer = await response.arrayBuffer()
        this.loadMidiData(arrayBuffer)
    }

    /**
     * Load MIDI from ArrayBuffer
     */
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

        // Sort by onset time
        this.notes.sort((a, b) => a.onset - b.onset)

        this.detectPitchRange()
        this.updateUsedPitches()
        this.render()
        this.emit('load', this.notes.length, this.trackCount)
    }

    /**
     * Load notes from JSON array
     */
    public loadNotes(notes: PianoRollNoteInput[], pitchIsHz = false): void {
        this.notes = notes.map(n => this.normalizeNote(n, pitchIsHz))
        this.notes.sort((a, b) => a.onset - b.onset)

        // Count unique tracks
        this.trackCount = new Set(this.notes.map(n => n.track)).size

        this.detectPitchRange()
        this.updateUsedPitches()
        this.render()
        this.emit('load', this.notes.length, this.trackCount)
    }

    /**
     * Load notes from CSV string (vocadito format)
     * Default format: onset,pitch,duration (no header)
     * Pitch can be Hz or MIDI number (auto-detected or specified)
     */
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

            notes.push({
                pitch,
                onset,
                duration,
            })
        }

        // Auto-detect Hz if not specified
        let detectHz = pitchIsHz
        if (detectHz === undefined && notes.length > 0) {
            // If any pitch value > 127, it's Hz
            detectHz = notes.some(n => (n.pitch as number) > 127)
        }

        this.loadNotes(notes, detectHz)
    }

    /**
     * Clear all notes
     */
    public clearNotes(): void {
        this.notes = []
        this.trackCount = 0
        this.usedPitches = []
        this.detectPitchRange()
        this.render()
    }

    /**
     * Get all loaded notes
     */
    public getNotes(): PianoRollNote[] {
        return [...this.notes]
    }

    /**
     * Get notes within a time range
     */
    public getNotesInRange(startTime: number, endTime: number): PianoRollNote[] {
        return this.notes.filter(n => n.onset >= startTime && n.onset < endTime)
    }

    /**
     * Get notes at a specific pitch
     */
    public getNotesAtPitch(pitch: number): PianoRollNote[] {
        return this.notes.filter(n => n.pitch === pitch)
    }

    /**
     * Get currently selected notes
     */
    public getSelectedNotes(): PianoRollNote[] {
        return Array.from(this.selectedNotes)
    }

    /**
     * Clear the current selection
     */
    public clearSelection(): void {
        if (this.selectedNotes.size > 0) {
            this.selectedNotes.clear()
            this.render()
            this.emit('selectionchange', [])
        }
    }

    /**
     * Select specific notes programmatically
     */
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

    /**
     * Delete all selected notes
     */
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

    /**
     * Set the pitch range manually
     */
    public setPitchRange(min: number, max: number): void {
        this.minPitch = clampPitch(min)
        this.maxPitch = clampPitch(max)
        this.render()
    }

    // ==================== Export Methods ====================

    /**
     * Export notes to MIDI file
     * @param filename Name for the downloaded file (default: 'notes.mid')
     * @param tempo BPM for the MIDI file (default: 120)
     */
    public exportMidi(filename = 'notes.mid', tempo = 120): void {
        if (this.notes.length === 0) {
            console.warn('No notes to export')
            return
        }

        // Create new MIDI
        const midi = new Midi()
        midi.header.setTempo(tempo)

        // Group notes by track
        const trackMap = new Map<number, PianoRollNote[]>()
        for (const note of this.notes) {
            const trackIdx = note.track
            if (!trackMap.has(trackIdx)) {
                trackMap.set(trackIdx, [])
            }
            trackMap.get(trackIdx)!.push(note)
        }

        // Add track for each group
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

        // Convert to Uint8Array and download
        const midiArray = midi.toArray()
        this.downloadFile(midiArray, filename, 'audio/midi')
    }

    /**
     * Export notes to JSON file
     * @param filename Name for the downloaded file (default: 'notes.json')
     */
    public exportJSON(filename = 'notes.json'): void {
        if (this.notes.length === 0) {
            console.warn('No notes to export')
            return
        }

        // Export notes with all properties
        const exportData = {
            version: '1.0',
            noteCount: this.notes.length,
            trackCount: this.trackCount,
            pitchRange: {
                min: this.minPitch,
                max: this.maxPitch,
            },
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

    /**
     * Helper to download a file
     */
    private downloadFile(data: Uint8Array | ArrayBuffer, filename: string, mimeType: string): void {
        // Create blob from data (use type assertion for strict TypeScript compatibility)
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

    /**
     * Called when wavesurfer is initialized
     */
    protected onInit(): void {
        if (!this.wavesurfer) {
            throw new Error('WaveSurfer is not initialized')
        }

        // Create DOM elements
        this.createElements()

        // Get the wrapper to attach scroll listener
        const wrapper = this.wavesurfer.getWrapper()
        const scrollContainer = wrapper.parentElement

        if (scrollContainer) {
            scrollContainer.addEventListener('scroll', this.onScroll)
        }

        // Subscribe to WaveSurfer events
        this.subscriptions.push(
            this.wavesurfer.on('zoom', this.onZoom)
        )

        this.subscriptions.push(
            this.wavesurfer.on('redrawcomplete', this.onRedraw)
        )

        this.subscriptions.push(
            this.wavesurfer.on('timeupdate', this.onTimeUpdate)
        )

        // Also listen to seeking event for when user clicks on waveform
        this.subscriptions.push(
            this.wavesurfer.on('seeking', (time: number) => {
                this.currentTime = time
                this.updatePlayhead()
                this.updateActiveNotes()
            })
        )

        // Stop preview notes when audio is paused
        this.subscriptions.push(
            this.wavesurfer.on('pause', () => {
                this.stopAllPreviewNotes()
            })
        )

        // Subscribe to decode event for spectrogram
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

        // Initial render
        this.detectPitchRange()
        this.render()

        // Initialize current time from wavesurfer
        this.currentTime = this.wavesurfer.getCurrentTime()
        this.updatePlayhead()

        this.emit('ready')
    }

    /**
     * Called by WaveSurfer to initialize the plugin
     */
    public _init(wavesurfer: WaveSurfer): void {
        this.wavesurfer = wavesurfer
        this.onInit()
    }

    /**
     * Destroys the plugin and releases resources
     */
    public destroy(): void {
        this.emit('destroy')

        // Remove scroll listener
        if (this.wavesurfer) {
            const wrapper = this.wavesurfer.getWrapper()
            const scrollContainer = wrapper.parentElement
            if (scrollContainer) {
                scrollContainer.removeEventListener('scroll', this.onScroll)
            }
        }

        // Remove mouse event listeners
        if (this.container) {
            this.container.removeEventListener('mousemove', this.onMouseMove)
            this.container.removeEventListener('mouseleave', this.onMouseLeave)
            this.container.removeEventListener('mousedown', this.onMouseDown)
            this.container.removeEventListener('dblclick', this.onDoubleClick)
        }

        // Clean up any active drag state
        if (this.dragState) {
            document.removeEventListener('mousemove', this.onDragMove)
            document.removeEventListener('mouseup', this.onDragEnd)
            this.dragState = null
        }

        // Clean up any active selection state
        if (this.selectionBox) {
            document.removeEventListener('mousemove', this.onSelectionDrag)
            document.removeEventListener('mouseup', this.onSelectionEnd)
            this.selectionBox = null
        }
        this.selectedNotes.clear()

        // Unsubscribe from wavesurfer events
        this.subscriptions.forEach((unsubscribe) => unsubscribe())
        this.subscriptions = []

        // Remove DOM elements
        this.container?.remove()

        // Clean up synths
        this.stopAllPreviewNotes()
        if (this.sineSynth) {
            this.sineSynth.dispose()
            this.sineSynth = null
        }
        if (this.triangleSynth) {
            this.triangleSynth.dispose()
            this.triangleSynth = null
        }
        if (this.pianoSynth) {
            this.pianoSynth.dispose()
            this.pianoSynth = null
        }

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
        this.synthTypeSelect = null
        this.controlsContainer = null
        this.tooltip = null
        this.hoveredNote = null
        this.notes = []
        this.usedPitches = []
        this.spectrogramData = []
        this.activeNotes.clear()
        this.playingNotes.clear()
    }
}
