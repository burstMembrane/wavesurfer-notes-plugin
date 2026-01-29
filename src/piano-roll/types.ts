/**
 * Events that can be emitted by the PianoRollPlugin
 */
export type PianoRollPluginEvents = {
    /** Emitted when the plugin is ready */
    ready: []
    /** Emitted when the plugin is destroyed */
    destroy: []
    /** Emitted when note data is loaded */
    load: [noteCount: number, trackCount: number]
    /** Emitted when a note is clicked */
    noteclick: [note: PianoRollNote, event: MouseEvent]
    /** Emitted when hovering over a note */
    notehover: [note: PianoRollNote | null, event: MouseEvent]
    /** Emitted when a note is dragged (moved or pitch changed) */
    notedrag: [note: PianoRollNote, originalNote: PianoRollNote]
    /** Emitted when a note is resized (duration changed) */
    noteresize: [note: PianoRollNote, originalNote: PianoRollNote]
    /** Emitted when a new note is created (double-click) */
    notecreate: [note: PianoRollNote]
    /** Emitted when a note is deleted (shift+click) */
    notedelete: [note: PianoRollNote]
    /** Emitted when note selection changes */
    selectionchange: [notes: PianoRollNote[]]
    /** Emitted after any note edit operation completes */
    noteschange: []
}

/** Color mode for notes */
export type PianoRollColorMode = 'velocity' | 'track' | 'channel' | 'fixed'

/**
 * Configuration options for the PianoRollPlugin
 */
export interface PianoRollPluginOptions {
    /** Height of the piano roll in pixels. Default: 200 */
    height?: number
    /** Minimum MIDI pitch to display (0-127). Default: auto-detect from data */
    minPitch?: number
    /** Maximum MIDI pitch to display (0-127). Default: auto-detect from data */
    maxPitch?: number
    /** Show piano keyboard gutter on the left. Default: true */
    showKeyboard?: boolean
    /** Width of the piano keyboard gutter in pixels. Default: 50 */
    keyboardWidth?: number
    /** Color scheme for notes. Default: 'velocity' */
    colorMode?: PianoRollColorMode
    /** Fixed note color (when colorMode is 'fixed'). Default: '#4a90d9' */
    noteColor?: string
    /** Color palette for tracks/channels. Default: built-in palette */
    colorPalette?: string[]
    /** Note border color. Default: 'rgba(0,0,0,0.3)' */
    noteBorderColor?: string
    /** Note border width in pixels. Default: 1 */
    noteBorderWidth?: number
    /** Note corner radius in pixels. Default: 2 */
    noteRadius?: number
    /** Background color of the piano roll. Default: '#1a1a2e' */
    backgroundColor?: string
    /** Show grid lines. Default: true */
    showGrid?: boolean
    /** Grid line color. Default: 'rgba(128,128,128,0.2)' */
    gridColor?: string
    /** Playhead color. Default: '#e94560' */
    playheadColor?: string
    /** Playhead width in pixels. Default: 2 */
    playheadWidth?: number
    /** Active (currently playing) note color. Default: '#ffffff' */
    activeNoteColor?: string
    /** Active note glow/shadow. Default: true */
    activeNoteGlow?: boolean
    /** Show fold button to collapse unused pitches. Default: true */
    showFoldButton?: boolean
    /** Start in folded mode. Default: false */
    foldedByDefault?: boolean

    // Spectrogram options
    /** Show spectrogram as background behind notes. Default: false */
    showSpectrogram?: boolean
    /** Number of FFT samples. Must be a power of 2. Default: 1024 */
    fftSamples?: number
    /** Minimum frequency to display in Hz. Default: 20 */
    frequencyMin?: number
    /** Maximum frequency to display in Hz. Default: 20000 */
    frequencyMax?: number
    /** Spectrogram opacity (0-1). Default: 0.7 */
    spectrogramOpacity?: number
    /**
     * Spectrogram color map.
     * - 'default': Purple/blue to orange/yellow gradient
     * - 'grayscale': Black to white gradient
     * - 'viridis': Viridis color scheme
     */
    spectrogramColorMap?: 'default' | 'grayscale' | 'viridis'
    /**
     * Spectrogram overlap ratio (0-0.95).
     * Higher values = more FFT frames = smoother time resolution.
     * Default: 0.75 (75% overlap)
     */
    spectrogramOverlap?: number
    /**
     * Enable snapping to spectrogram peaks when double-clicking.
     * When enabled, double-click will detect bright regions in the spectrogram
     * and create notes that match the detected pitch and duration.
     * Default: false
     */
    snapToSpectrogram?: boolean
}

/**
 * Individual note in the piano roll (normalized format)
 */
export interface PianoRollNote {
    /** MIDI pitch (0-127) */
    pitch: number
    /** Note name (e.g., "C4", "A#3") - computed if not provided */
    name: string
    /** Start time in seconds */
    onset: number
    /** End time in seconds */
    offset: number
    /** Duration in seconds (offset - onset) */
    duration: number
    /** Velocity (0-1 normalized). Default: 0.8 */
    velocity: number
    /** Track index (for multi-track MIDI). Default: 0 */
    track: number
    /** MIDI channel (0-15). Default: 0 */
    channel: number
    /** Optional custom color override */
    color?: string
}

/**
 * Input format for JSON/programmatic note data
 * Supports flexible pitch input (MIDI number, note name, or Hz frequency)
 */
export interface PianoRollNoteInput {
    /** MIDI pitch (0-127) OR note name (e.g., "C4", "A#3") */
    pitch: number | string
    /** Start time in seconds */
    onset: number
    /** End time in seconds (alternative to duration) */
    offset?: number
    /** Duration in seconds (alternative to offset) */
    duration?: number
    /** Velocity 0-1 (normalized) or 0-127 (MIDI). Default: 0.8 */
    velocity?: number
    /** Track index. Default: 0 */
    track?: number
    /** MIDI channel. Default: 0 */
    channel?: number
    /** Optional custom color override */
    color?: string
}

/**
 * Options for parsing CSV note data
 */
export interface CSVParseOptions {
    /** Whether the CSV has a header row. Default: false */
    hasHeader?: boolean
    /** Column index for onset time (0-based). Default: 0 */
    onsetColumn?: number
    /** Column index for pitch. Default: 1 */
    pitchColumn?: number
    /** Column index for duration. Default: 2 */
    durationColumn?: number
    /**
     * Whether pitch values are in Hz (frequency).
     * If true, values are converted to MIDI pitch.
     * If false, values are treated as MIDI pitch numbers.
     * Default: auto-detect (values > 127 are assumed to be Hz)
     */
    pitchIsHz?: boolean
    /** Column delimiter. Default: ',' */
    delimiter?: string
}

/**
 * Default color palette for tracks/channels
 */
export const DEFAULT_COLOR_PALETTE = [
    '#e94560', // Red
    '#4ecca3', // Teal
    '#00d9ff', // Cyan
    '#ffd93d', // Yellow
    '#ff6b9d', // Pink
    '#c44dff', // Purple
    '#ff8c42', // Orange
    '#98d8c8', // Mint
]
