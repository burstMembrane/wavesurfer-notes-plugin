/**
 * Note names for each pitch class (0-11)
 */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/**
 * Alternative enharmonic spellings (sharp to flat)
 */
const SHARP_TO_FLAT: Record<string, string> = {
    'C#': 'Db',
    'D#': 'Eb',
    'F#': 'Gb',
    'G#': 'Ab',
    'A#': 'Bb',
}

/**
 * Convert MIDI pitch number to note name
 * @param pitch MIDI pitch (0-127)
 * @returns Note name like "C4", "A#3"
 */
export function pitchToNoteName(pitch: number): string {
    const octave = Math.floor(pitch / 12) - 1
    const noteIndex = pitch % 12
    return `${NOTE_NAMES[noteIndex]}${octave}`
}

/**
 * Convert note name to MIDI pitch
 * @param name Note name like "C4", "Db3", "A#5"
 * @returns MIDI pitch (0-127)
 * @throws Error if note name is invalid
 */
export function noteNameToPitch(name: string): number {
    // Parse note name with regex: (note)(accidental?)(octave)
    const match = name.match(/^([A-Ga-g])(#|b)?(-?\d+)$/)
    if (!match) {
        throw new Error(`Invalid note name: ${name}`)
    }

    let [, note, accidental, octaveStr] = match
    note = note.toUpperCase()
    const octave = parseInt(octaveStr, 10)

    // Find base pitch class
    let pitchClass = NOTE_NAMES.indexOf(note)
    if (pitchClass === -1) {
        // Try without accidental in note name
        pitchClass = NOTE_NAMES.findIndex(n => n.startsWith(note))
        if (pitchClass === -1) {
            throw new Error(`Invalid note: ${note}`)
        }
    }

    // Apply accidental
    if (accidental === '#') pitchClass += 1
    if (accidental === 'b') pitchClass -= 1

    // Handle wrap-around (e.g., Cb = B, B# = C)
    pitchClass = ((pitchClass % 12) + 12) % 12

    // Calculate MIDI pitch
    return (octave + 1) * 12 + pitchClass
}

/**
 * Convert frequency in Hz to MIDI pitch number
 * Uses the standard formula: MIDI = 69 + 12 * log2(frequency / 440)
 * @param hz Frequency in Hz
 * @returns MIDI pitch (0-127, may be fractional for microtonal)
 */
export function hzToMidi(hz: number): number {
    if (hz <= 0) return 0
    return 69 + 12 * Math.log2(hz / 440)
}

/**
 * Convert frequency in Hz to nearest MIDI pitch (quantized to semitone)
 * @param hz Frequency in Hz
 * @returns MIDI pitch (0-127, integer)
 */
export function hzToMidiQuantized(hz: number): number {
    return Math.round(hzToMidi(hz))
}

/**
 * Convert MIDI pitch to frequency in Hz
 * @param midi MIDI pitch number
 * @returns Frequency in Hz
 */
export function midiToHz(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12)
}

/**
 * Check if a MIDI pitch corresponds to a black key on a piano
 * @param pitch MIDI pitch (0-127)
 * @returns true if black key (C#, D#, F#, G#, A#)
 */
export function isBlackKey(pitch: number): boolean {
    const pitchClass = pitch % 12
    return [1, 3, 6, 8, 10].includes(pitchClass)
}

/**
 * Check if a MIDI pitch corresponds to a white key on a piano
 * @param pitch MIDI pitch (0-127)
 * @returns true if white key (C, D, E, F, G, A, B)
 */
export function isWhiteKey(pitch: number): boolean {
    return !isBlackKey(pitch)
}

/**
 * Get the note name with flat spelling instead of sharp
 * @param pitch MIDI pitch (0-127)
 * @returns Note name like "C4", "Db3"
 */
export function pitchToNoteNameFlat(pitch: number): string {
    const octave = Math.floor(pitch / 12) - 1
    const noteIndex = pitch % 12
    const noteName = NOTE_NAMES[noteIndex]

    if (SHARP_TO_FLAT[noteName]) {
        return `${SHARP_TO_FLAT[noteName]}${octave}`
    }
    return `${noteName}${octave}`
}

/**
 * Determine if a numeric pitch value is likely Hz or MIDI
 * Hz values are typically 20-4000+, MIDI values are 0-127
 * @param value Numeric pitch value
 * @returns true if the value appears to be Hz
 */
export function isProbablyHz(value: number): boolean {
    // MIDI range is 0-127, Hz for musical notes typically 20Hz-4000Hz
    // Values > 127 are definitely Hz
    // Values between 20-127 are ambiguous but more likely to be MIDI if < 20
    return value > 127
}

/**
 * Convert a pitch value to MIDI, auto-detecting Hz vs MIDI
 * @param pitch Pitch value (MIDI number, note name string, or Hz frequency)
 * @param forceHz If true, treat numeric values as Hz
 * @returns MIDI pitch (0-127)
 */
export function toMidiPitch(pitch: number | string, forceHz = false): number {
    if (typeof pitch === 'string') {
        return noteNameToPitch(pitch)
    }

    if (forceHz || isProbablyHz(pitch)) {
        return hzToMidiQuantized(pitch)
    }

    return Math.round(pitch)
}

/**
 * Count the number of white keys in a pitch range
 * @param minPitch Minimum MIDI pitch
 * @param maxPitch Maximum MIDI pitch
 * @returns Number of white keys in the range (inclusive)
 */
export function countWhiteKeys(minPitch: number, maxPitch: number): number {
    let count = 0
    for (let pitch = minPitch; pitch <= maxPitch; pitch++) {
        if (isWhiteKey(pitch)) count++
    }
    return count
}

/**
 * Clamp a MIDI pitch to valid range
 * @param pitch MIDI pitch
 * @returns Clamped pitch (0-127)
 */
export function clampPitch(pitch: number): number {
    return Math.max(0, Math.min(127, Math.round(pitch)))
}
