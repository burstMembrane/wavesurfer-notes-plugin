import type { PianoRollNote, PianoRollColorMode } from './types'
import { DEFAULT_COLOR_PALETTE } from './types'

/**
 * Options for calculating note color
 */
export interface NoteColorOptions {
    colorMode: PianoRollColorMode
    noteColor: string
    colorPalette: string[]
}

/**
 * Get color for a note based on color mode
 */
export function getNoteColor(note: PianoRollNote, options: NoteColorOptions): string {
    if (note.color) return note.color

    const { colorMode, noteColor, colorPalette } = options

    switch (colorMode) {
        case 'velocity': {
            // Interpolate from dark to bright based on velocity
            const v = note.velocity
            const r = Math.round(73 + v * 160)
            const g = Math.round(144 + v * 80)
            const b = Math.round(217 - v * 40)
            return `rgb(${r}, ${g}, ${b})`
        }
        case 'track':
            return colorPalette[note.track % colorPalette.length]
        case 'channel':
            return colorPalette[note.channel % colorPalette.length]
        case 'fixed':
        default:
            return noteColor
    }
}

/**
 * Create default note color options
 */
export function createDefaultNoteColorOptions(): NoteColorOptions {
    return {
        colorMode: 'velocity',
        noteColor: '#4a90d9',
        colorPalette: DEFAULT_COLOR_PALETTE,
    }
}
