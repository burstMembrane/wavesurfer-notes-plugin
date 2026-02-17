import type { PianoRollNote } from './types'
import type { CoordinateParams } from './coordinates'
import { getDisplayPitches, timeToPx, pitchToPx, getNoteHeight } from './coordinates'
import { getNoteColor, type NoteColorOptions } from './note-color'
import { isBlackKey, pitchToNoteName, midiToHz } from './note-utils'
import { renderSpectrogramToImageData, type ColorMapType } from './spectrogram'

/**
 * State needed for rendering notes
 */
export interface NoteRenderState {
    activeNotes: Set<PianoRollNote>
    selectedNotes: Set<PianoRollNote>
    dragState: {
        note: PianoRollNote
        originalNote: PianoRollNote
        mode: 'move' | 'resize-left' | 'resize-right'
        multiDrag?: {
            notes: PianoRollNote[]
            originals: PianoRollNote[]
        }
    } | null
    selectionBox: {
        startX: number
        startY: number
        endX: number
        endY: number
    } | null
}

/**
 * Render options extracted from plugin options
 */
export interface RenderOptions {
    backgroundColor: string
    showGrid: boolean
    gridColor: string
    showSpectrogram: boolean
    noteBorderColor: string
    noteBorderWidth: number
    noteRadius: number
    activeNoteColor: string
    activeNoteGlow: boolean
    playheadColor: string
}

/**
 * Render grid lines on the canvas
 */
export function renderGrid(
    ctx: CanvasRenderingContext2D,
    coords: CoordinateParams,
    options: RenderOptions
): void {
    const { width, height, duration } = coords

    // Clear the canvas first (transparent background to show spectrogram)
    ctx.clearRect(0, 0, width, height)

    // If no spectrogram, fill with background color
    if (!options.showSpectrogram) {
        ctx.fillStyle = options.backgroundColor
        ctx.fillRect(0, 0, width, height)
    }

    if (!options.showGrid) return

    // Use more subtle grid when spectrogram is visible
    ctx.strokeStyle = options.showSpectrogram ? 'rgba(255,255,255,0.1)' : options.gridColor
    ctx.lineWidth = 1

    // Draw horizontal pitch lines using display pitches (respects fold state)
    const pitches = getDisplayPitches(coords)
    const noteHeight = height / pitches.length

    // Draw from top (high pitch) to bottom (low pitch)
    for (let i = 0; i < pitches.length; i++) {
        const pitch = pitches[pitches.length - 1 - i] // Reversed order
        const y = i * noteHeight

        // Darker background for black keys (only when no spectrogram)
        if (!options.showSpectrogram && isBlackKey(pitch)) {
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
            const x = timeToPx(t, coords)
            const isWhole = t % 1 === 0

            // Use more subtle grid when spectrogram is visible
            if (options.showSpectrogram) {
                ctx.strokeStyle = isWhole ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)'
            } else {
                ctx.strokeStyle = isWhole ? 'rgba(128,128,128,0.3)' : options.gridColor
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
 * Render ghost notes during drag operations
 */
function renderDragGhosts(
    ctx: CanvasRenderingContext2D,
    coords: CoordinateParams,
    state: NoteRenderState,
    colorOptions: NoteColorOptions,
    noteRadius: number
): void {
    if (!state.dragState) return

    const { originalNote, note, multiDrag } = state.dragState
    const noteHeight = getNoteHeight(coords)

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
                const gx = timeToPx(orig.onset, coords)
                const gw = Math.max(timeToPx(orig.offset, coords) - gx, 2)
                const gy = pitchToPx(orig.pitch, coords)
                const gh = noteHeight - 1

                ctx.save()
                ctx.globalAlpha = 0.3
                ctx.fillStyle = getNoteColor(orig, colorOptions)
                ctx.beginPath()
                ctx.roundRect(gx, gy, gw, gh, noteRadius)
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
            const gx = timeToPx(originalNote.onset, coords)
            const gw = Math.max(timeToPx(originalNote.offset, coords) - gx, 2)
            const gy = pitchToPx(originalNote.pitch, coords)
            const gh = noteHeight - 1

            ctx.save()
            ctx.globalAlpha = 0.3
            ctx.fillStyle = getNoteColor(originalNote, colorOptions)
            ctx.beginPath()
            ctx.roundRect(gx, gy, gw, gh, noteRadius)
            ctx.fill()

            ctx.setLineDash([4, 4])
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = 1
            ctx.stroke()
            ctx.restore()
        }
    }
}

/**
 * Render all notes on the canvas
 */
export function renderNotes(
    ctx: CanvasRenderingContext2D,
    notes: PianoRollNote[],
    coords: CoordinateParams,
    state: NoteRenderState,
    colorOptions: NoteColorOptions,
    renderOptions: RenderOptions
): void {
    const noteHeight = getNoteHeight(coords)
    const { minPitch, maxPitch } = coords

    // Draw ghost of original position if dragging
    renderDragGhosts(ctx, coords, state, colorOptions, renderOptions.noteRadius)

    for (const note of notes) {
        // Skip notes outside visible pitch range
        if (note.pitch < minPitch || note.pitch > maxPitch) continue

        const x = timeToPx(note.onset, coords)
        const w = Math.max(timeToPx(note.offset, coords) - x, 2)
        const y = pitchToPx(note.pitch, coords)
        const h = noteHeight - 1

        const isActive = state.activeNotes.has(note)
        const isDragging = state.dragState?.note === note
        const isSelected = state.selectedNotes.has(note)

        // Draw glow for active, dragged, or selected notes
        if ((isActive && renderOptions.activeNoteGlow) || isDragging || isSelected) {
            ctx.save()
            ctx.shadowColor = isDragging ? '#00ffff' : isSelected ? '#ffff00' : renderOptions.activeNoteColor
            ctx.shadowBlur = isDragging ? 20 : isSelected ? 12 : 15
            ctx.fillStyle = isDragging ? '#00ffff' : isSelected ? '#ffff00' : renderOptions.activeNoteColor
            ctx.beginPath()
            ctx.roundRect(x, y, w, h, renderOptions.noteRadius)
            ctx.fill()
            ctx.restore()
        }

        // Draw note rectangle
        let fillColor = getNoteColor(note, colorOptions)
        if (isActive) {
            fillColor = renderOptions.activeNoteColor
        } else if (isDragging) {
            fillColor = '#00dddd'
        } else if (isSelected) {
            fillColor = '#ffcc00'
        }

        ctx.fillStyle = fillColor
        ctx.beginPath()
        ctx.roundRect(x, y, w, h, renderOptions.noteRadius)
        ctx.fill()

        // Draw border
        if (renderOptions.noteBorderWidth > 0) {
            ctx.strokeStyle = isActive ? renderOptions.activeNoteColor : isDragging ? '#00ffff' : isSelected ? '#ffff00' : renderOptions.noteBorderColor
            ctx.lineWidth = (isActive || isDragging || isSelected) ? 2 : renderOptions.noteBorderWidth
            ctx.stroke()
        }
    }

    // Draw selection box if active
    renderSelectionBox(ctx, state.selectionBox)
}

/**
 * Render the selection box during drag
 */
export function renderSelectionBox(
    ctx: CanvasRenderingContext2D,
    selectionBox: NoteRenderState['selectionBox']
): void {
    if (!selectionBox) return

    const box = selectionBox
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
export function renderKeyboard(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    coords: CoordinateParams,
    activePitches: Set<number>,
    playheadColor: string
): void {
    // Clear
    ctx.fillStyle = '#0a0a15'
    ctx.fillRect(0, 0, width, height)

    // Use display pitches (respects fold state)
    const pitches = getDisplayPitches(coords)
    const noteHeight = height / pitches.length

    // Draw keys from top (high pitch) to bottom (low pitch)
    for (let i = 0; i < pitches.length; i++) {
        const pitch = pitches[pitches.length - 1 - i] // Reversed order
        const y = i * noteHeight
        const isBlack = isBlackKey(pitch)
        const isActive = activePitches.has(pitch)

        if (isActive) {
            // Active key - use playhead color (red)
            ctx.fillStyle = playheadColor
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
        const showLabel = coords.isFolded || pitch % 12 === 0
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
export function renderSpectrogram(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    spectrogramData: Float32Array[],
    audioSampleRate: number,
    fftSize: number,
    coords: CoordinateParams,
    backgroundColor: string,
    colorMap: ColorMapType
): void {
    // Clear and fill with background color first
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, width, height)

    // If no spectrogram data yet, just show background
    if (spectrogramData.length === 0) return

    // Calculate frequency range from pitch range to align with piano roll
    const pitches = getDisplayPitches(coords)
    const minDisplayPitch = Math.min(...pitches)
    const maxDisplayPitch = Math.max(...pitches)

    // Convert MIDI pitch to Hz for spectrogram frequency range
    const frequencyMin = midiToHz(minDisplayPitch - 0.5)
    const frequencyMax = midiToHz(maxDisplayPitch + 0.5)

    // Render spectrogram to image data with pitch-aligned frequency range
    const imageData = renderSpectrogramToImageData(
        spectrogramData,
        width,
        height,
        audioSampleRate,
        fftSize,
        frequencyMin,
        frequencyMax,
        colorMap
    )

    // Draw to canvas
    ctx.putImageData(imageData, 0, 0)
}
