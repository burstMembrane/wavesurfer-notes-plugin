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
    private synthTypeSelect: HTMLSelectElement | null = null
    private currentSynthType: PreviewSynthType = 'synth'
    private sineSynth: Tone.PolySynth | null = null
    private triangleSynth: Tone.PolySynth | null = null
    private pianoSynth: Tone.PolySynth | null = null  // FM synth with piano-like sound
    private playingNotes: Set<string> = new Set() // Track which notes are currently sounding

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
     * Convert MIDI pitch to Y pixel position
     */
    private pitchToPx(pitch: number): number {
        if (!this.canvas) return 0
        const pitches = this.getDisplayPitches()
        const noteHeight = this.canvas.height / pitches.length

        if (this.isFolded) {
            // Find index of pitch in used pitches (reversed for high at top)
            const idx = pitches.indexOf(pitch)
            if (idx === -1) return -100 // Off-screen if not in list
            return this.canvas.height - ((idx + 1) * noteHeight)
        } else {
            // Higher pitches at top (lower Y)
            return this.canvas.height - ((pitch - this.minPitch + 1) * noteHeight)
        }
    }

    /**
     * Get the height of a single note in pixels
     */
    private getNoteHeight(): number {
        if (!this.canvas) return 10
        const pitches = this.getDisplayPitches()
        return this.canvas.height / pitches.length
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
            this.foldButton.addEventListener('click', () => this.toggleFold())
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
            this.previewButton.addEventListener('click', () => this.togglePreview())
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
                this.setSynthType((e.target as HTMLSelectElement).value as PreviewSynthType)
            })
            this.controlsContainer.appendChild(this.synthTypeSelect)

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

        // Add mouse event listeners for hover
        this.container.addEventListener('mousemove', this.onMouseMove)
        this.container.addEventListener('mouseleave', this.onMouseLeave)

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
        if (!this.canvas || !this.wavesurfer) return

        const opts = this.getOptions()
        const wrapper = this.wavesurfer.getWrapper()

        // Match the wrapper's scroll width (full zoomed width)
        this.canvas.width = wrapper.scrollWidth
        this.canvas.height = opts.height

        // Also resize spectrogram canvas
        if (this.spectrogramCanvas) {
            this.spectrogramCanvas.width = wrapper.scrollWidth
            this.spectrogramCanvas.height = opts.height
        }

        // No need to manually offset - we're inside the scrolling wrapper now
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
        const width = this.canvas.width
        const height = this.canvas.height
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

        for (const note of this.notes) {
            // Skip notes outside visible pitch range
            if (note.pitch < this.minPitch || note.pitch > this.maxPitch) continue

            const x = this.timeToPx(note.onset)
            const w = Math.max(this.timeToPx(note.offset) - x, 2)
            const y = this.pitchToPx(note.pitch)
            const h = noteHeight - 1

            const isActive = this.activeNotes.has(note)

            // Draw glow for active notes
            if (isActive && opts.activeNoteGlow) {
                ctx.save()
                ctx.shadowColor = opts.activeNoteColor
                ctx.shadowBlur = 15
                ctx.fillStyle = opts.activeNoteColor
                ctx.beginPath()
                ctx.roundRect(x, y, w, h, opts.noteRadius)
                ctx.fill()
                ctx.restore()
            }

            // Draw note rectangle
            ctx.fillStyle = isActive ? opts.activeNoteColor : this.getNoteColor(note)
            ctx.beginPath()
            ctx.roundRect(x, y, w, h, opts.noteRadius)
            ctx.fill()

            // Draw border
            if (opts.noteBorderWidth > 0) {
                ctx.strokeStyle = isActive ? opts.activeNoteColor : opts.noteBorderColor
                ctx.lineWidth = isActive ? 2 : opts.noteBorderWidth
                ctx.stroke()
            }
        }
    }

    /**
     * Render the piano keyboard
     */
    private renderKeyboard(): void {
        if (!this.keyboardCtx || !this.keyboardCanvas) return

        const ctx = this.keyboardCtx
        const width = this.keyboardCanvas.width
        const height = this.keyboardCanvas.height

        // Clear
        ctx.fillStyle = '#0a0a15'
        ctx.fillRect(0, 0, width, height)

        // Use display pitches (respects fold state)
        const pitches = this.getDisplayPitches()
        const noteHeight = height / pitches.length

        // Draw keys from top (high pitch) to bottom (low pitch)
        for (let i = 0; i < pitches.length; i++) {
            const pitch = pitches[pitches.length - 1 - i] // Reversed order
            const y = i * noteHeight
            const isBlack = isBlackKey(pitch)

            if (isBlack) {
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
                ctx.fillStyle = isBlack ? '#aaa' : '#333'
                ctx.font = `${Math.min(10, Math.max(8, noteHeight - 2))}px sans-serif`
                const labelX = isBlack ? width * 0.65 : 2
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
        const imageData = renderSpectrogramToImageData(
            this.spectrogramData,
            width,
            height,
            this.audioSampleRate,
            opts.fftSamples,
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

        // Calculate spectrogram
        const hopSize = Math.floor(opts.fftSamples / 4)
        this.spectrogramData = calculateSpectrogram(
            audioData,
            this.audioSampleRate,
            opts.fftSamples,
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

        const rect = this.container.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top

        // Since container is inside the scrolling wrapper, getBoundingClientRect
        // already accounts for scroll position - x is the absolute position
        const note = this.findNoteAtPosition(x, y)

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
     * Set the pitch range manually
     */
    public setPitchRange(min: number, max: number): void {
        this.minPitch = clampPitch(min)
        this.maxPitch = clampPitch(max)
        this.render()
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
        }

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
