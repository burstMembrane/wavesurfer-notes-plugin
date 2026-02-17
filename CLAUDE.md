# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WaveSurfer Piano Roll Plugin - a TypeScript library that adds an interactive, editable piano roll visualization to wavesurfer.js audio waveform displays. Supports MIDI import/export, JSON, and CSV (vocadito format with Hz frequencies).

## Commands

```bash
npm run dev          # Start dev server with hot reload (examples at localhost)
npm run build        # TypeScript check + Vite build (outputs to dist/)
npm run build-example # Build example demo only
npm run preview      # Preview production build
```

## Architecture

### Core Files
- `src/piano-roll.ts` - Main plugin class, extends wavesurfer.js BasePlugin
- `src/piano-roll/types.ts` - TypeScript interfaces (PianoRollNote, PianoRollPluginOptions, events)
- `src/index.ts` - Public API exports

### Helper Modules (`src/piano-roll/`)
- `synth-manager.ts` - SynthManager class for audio preview (Tone.js PolySynth)
- `coordinates.ts` - Time/pitch to pixel coordinate conversions
- `rendering.ts` - Canvas rendering functions (grid, notes, keyboard, spectrogram)
- `dom-factory.ts` - DOM element creation helpers (buttons, controls, tooltip)
- `note-color.ts` - Note color calculation by velocity/track/channel
- `note-utils.ts` - MIDI/pitch conversion utilities (Hz<->MIDI, note names)
- `spectrogram.ts` - FFT implementation (Cooley-Tukey) and spectrogram rendering

### Build Output
- `dist/piano-roll-plugin.es.js` - ESM bundle
- `dist/piano-roll-plugin.umd.js` - UMD bundle
- `dist/types/` - Generated TypeScript declarations

### Key Dependencies
- `wavesurfer.js@7` - Peer dependency, audio waveform library
- `@tonejs/midi` - MIDI file parsing
- `tone` - Web Audio synthesis for note preview

### Plugin Lifecycle
1. Create via `PianoRollPlugin.create(options)`
2. Register with `wavesurfer.registerPlugin(plugin)`
3. Load notes via `loadMidi()`, `loadNotes()`, or `loadCSV()`
4. Plugin emits events: `ready`, `load`, `notecreate`, `notedelete`, `notedrag`, `noteresize`, `noteschange`, `selectionchange`

### Canvas Rendering Architecture
Layered rendering in order:
1. Background spectrogram (optional, uses FFT analysis)
2. Grid lines
3. Note rectangles (colored by velocity/track/channel)
4. Piano keyboard gutter (left side)
5. Playhead indicator
6. Tooltip overlay

Uses DPR (device pixel ratio) scaling for crisp rendering on high-DPI displays.

### Note Data Model
```typescript
interface PianoRollNote {
  pitch: number      // MIDI 0-127
  name: string       // "C4", "A#3"
  onset: number      // Start time (seconds)
  offset: number     // End time (seconds)
  duration: number   // seconds
  velocity: number   // 0-1 normalized
  track: number      // Multi-track support
  channel: number    // MIDI channel 0-15
}
```

### User Interactions
- Double-click: Create note at position
- Drag: Move note (time/pitch)
- Edge drag: Resize note duration
- Shift+click: Delete note
- Box select: Multi-select notes

### Path Aliases (tsconfig.json)
- `@/` -> `src/`
- `@src/` -> `src/`
