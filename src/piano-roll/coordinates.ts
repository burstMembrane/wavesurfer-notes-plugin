import { clampPitch } from './note-utils'

/**
 * Parameters needed for coordinate conversions
 */
export interface CoordinateParams {
    /** Total width of the canvas/wrapper in pixels */
    width: number
    /** Total height of the display in pixels */
    height: number
    /** Duration of the audio in seconds */
    duration: number
    /** Minimum MIDI pitch in range */
    minPitch: number
    /** Maximum MIDI pitch in range */
    maxPitch: number
    /** Whether display is in folded mode */
    isFolded: boolean
    /** List of used pitches (for folded mode) */
    usedPitches: number[]
}

/**
 * Get the list of pitches to display based on fold state
 */
export function getDisplayPitches(params: CoordinateParams): number[] {
    const { isFolded, usedPitches, minPitch, maxPitch } = params

    if (isFolded && usedPitches.length > 0) {
        return usedPitches
    }

    const pitches: number[] = []
    for (let p = minPitch; p <= maxPitch; p++) {
        pitches.push(p)
    }
    return pitches
}

/**
 * Get the height of a single note row in pixels
 */
export function getNoteHeight(params: CoordinateParams): number {
    const pitches = getDisplayPitches(params)
    return params.height / pitches.length
}

/**
 * Convert time (seconds) to pixel X position
 */
export function timeToPx(time: number, params: CoordinateParams): number {
    if (params.duration === 0) return 0
    return (time / params.duration) * params.width
}

/**
 * Convert pixel X position to time (seconds)
 */
export function pxToTime(px: number, params: CoordinateParams): number {
    return (px / params.width) * params.duration
}

/**
 * Convert MIDI pitch to Y pixel position
 * Higher pitches are at the top (lower Y values)
 */
export function pitchToPx(pitch: number, params: CoordinateParams): number {
    const pitches = getDisplayPitches(params)
    const noteHeight = params.height / pitches.length

    if (params.isFolded) {
        const idx = pitches.indexOf(pitch)
        if (idx === -1) return -100 // Off-screen if not in list
        return params.height - ((idx + 1) * noteHeight)
    } else {
        return params.height - ((pitch - params.minPitch + 1) * noteHeight)
    }
}

/**
 * Convert Y pixel position to MIDI pitch
 */
export function pxToPitch(y: number, params: CoordinateParams): number {
    const pitches = getDisplayPitches(params)
    const noteHeight = params.height / pitches.length

    if (params.isFolded) {
        const idx = Math.floor((params.height - y) / noteHeight)
        if (idx < 0) return pitches[0]
        if (idx >= pitches.length) return pitches[pitches.length - 1]
        return pitches[idx]
    } else {
        const pitch = params.minPitch + (params.height - y) / noteHeight - 1
        return clampPitch(Math.round(pitch))
    }
}

/**
 * Create a CoordinateParams object from plugin state
 * This is a helper for creating params from the plugin's internal state
 */
export function createCoordinateParams(
    width: number,
    height: number,
    duration: number,
    minPitch: number,
    maxPitch: number,
    isFolded: boolean,
    usedPitches: number[]
): CoordinateParams {
    return {
        width,
        height,
        duration,
        minPitch,
        maxPitch,
        isFolded,
        usedPitches,
    }
}
