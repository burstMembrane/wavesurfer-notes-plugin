# WaveSurfer Piano Roll Plugin

A WaveSurfer.js plugin that provides a piano roll visualization for MIDI data.

## Installation

```bash
npm install wavesurfer-piano-roll-plugin
```

## Usage

```javascript
import WaveSurfer from 'wavesurfer.js'
import { PianoRollPlugin } from 'wavesurfer-piano-roll-plugin'

const wavesurfer = WaveSurfer.create({
  container: '#waveform',
  url: 'audio.mp3'
})

const pianoRollPlugin = PianoRollPlugin.create()
wavesurfer.registerPlugin(pianoRollPlugin)
```

## Development

```bash
npm install
npm run dev
```

## License

MIT
