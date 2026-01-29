import WaveSurfer from 'wavesurfer.js'
import ZoomPlugin from 'wavesurfer.js/dist/plugins/zoom.js'
import { PianoRollPlugin } from '@/index'
import "./style.css"

const tailwindScript = document.createElement('script')
tailwindScript.src = 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4'
tailwindScript.type = 'text/javascript'
document.querySelector<HTMLHeadElement>('head')?.appendChild(tailwindScript)

// Add dark mode script
const darkModeScript = document.createElement('script')
darkModeScript.textContent = `
  if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
`
document.head.appendChild(darkModeScript)

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="flex flex-col items-center justify-start min-h-screen w-full bg-gray-50 dark:bg-gray-900">
    <div class="w-full max-w-4xl mx-auto p-6">
      <h1 class="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">WaveSurfer Piano Roll Plugin</h1>
      <p class="text-gray-600 dark:text-gray-400 mb-4">Editable piano roll with spectrogram. Double-click to create notes, drag to move/resize, Shift+click to delete.</p>

      <div class="flex flex-wrap gap-4 mb-4">
        <div class="flex-1 min-w-[200px]">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Load Audio</label>
          <input type="file" id="audio-input" accept="audio/*" class="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900 dark:file:text-blue-300" />
        </div>
        <div class="flex-1 min-w-[200px]">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Load MIDI</label>
          <input type="file" id="midi-input" accept=".mid,.midi" class="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100 dark:file:bg-green-900 dark:file:text-green-300" />
        </div>
        <div class="flex-1 min-w-[200px]">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Load JSON Notes</label>
          <input type="file" id="json-input" accept=".json" class="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 dark:file:bg-purple-900 dark:file:text-purple-300" />
        </div>
      </div>

      <div id="waveform" class="w-full max-w-full rounded-lg shadow-lg bg-white dark:bg-gray-800" style="overflow: hidden;"></div>

      <div id="note-info" class="mt-4 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm text-gray-600 dark:text-gray-400">
        Loading notes...
      </div>
    </div>
  </div>
`

let wavesurfer: WaveSurfer
let pianoRollPlugin: ReturnType<typeof PianoRollPlugin.create>

async function initWaveSurfer() {
  wavesurfer = WaveSurfer.create({
    container: document.querySelector<HTMLDivElement>('#waveform')!,
    height: 128,
    minPxPerSec: 50,
    url: "../vocadito/Audio/vocadito_12.wav",
    waveColor: '#4ecca3',
    progressColor: '#e94560',
    cursorWidth: 2,
    cursorColor: "#e94560",
    mediaControls: true,
    autoScroll: true,
    autoCenter: true,
  })

  // Register zoom plugin
  const zoomPlugin = ZoomPlugin.create({
    maxZoom: 200,
    exponentialZooming: true,
  })
  wavesurfer.registerPlugin(zoomPlugin)


  // Register piano roll plugin with spectrogram background
  pianoRollPlugin = PianoRollPlugin.create({
    height: 300,
    showKeyboard: true,
    colorMode: 'velocity',
    backgroundColor: '#1a1a2e',
    showSpectrogram: true,
    spectrogramOpacity: 1,
    spectrogramColorMap: 'default',
  })
  wavesurfer.registerPlugin(pianoRollPlugin)


  // Load vocadito notes CSV
  pianoRollPlugin.on('load', (noteCount, trackCount) => {
    const infoEl = document.getElementById('note-info')
    if (infoEl) {
      infoEl.textContent = `Loaded ${noteCount} notes (${trackCount} track${trackCount !== 1 ? 's' : ''})`
    }
  })

  // Wait for waveform to be ready, then load notes
  wavesurfer.on('ready', async () => {
    try {
      const response = await fetch('../vocadito/Annotations/Notes/vocadito_12_notesA1.csv')
      const csv = await response.text()
      pianoRollPlugin.loadCSV(csv, { pitchIsHz: true })
    } catch (error) {
      console.error('Failed to load notes:', error)
      const infoEl = document.getElementById('note-info')
      if (infoEl) {
        infoEl.textContent = `Error loading notes: ${error}`
      }
    }
  })
}

// File input handlers
function setupFileInputs() {
  // Audio file input
  const audioInput = document.getElementById('audio-input') as HTMLInputElement
  audioInput?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return

    const url = URL.createObjectURL(file)
    wavesurfer.load(url)

    // Clear existing notes when loading new audio
    pianoRollPlugin.clearNotes()

    const infoEl = document.getElementById('note-info')
    if (infoEl) {
      infoEl.textContent = `Loaded audio: ${file.name}`
    }
  })

  // MIDI file input
  const midiInput = document.getElementById('midi-input') as HTMLInputElement
  midiInput?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return

    try {
      const arrayBuffer = await file.arrayBuffer()
      pianoRollPlugin.loadMidiData(arrayBuffer)

      const infoEl = document.getElementById('note-info')
      if (infoEl) {
        infoEl.textContent = `Loading MIDI: ${file.name}...`
      }
    } catch (error) {
      console.error('Failed to load MIDI:', error)
      const infoEl = document.getElementById('note-info')
      if (infoEl) {
        infoEl.textContent = `Error loading MIDI: ${error}`
      }
    }
  })

  // JSON file input
  const jsonInput = document.getElementById('json-input') as HTMLInputElement
  jsonInput?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const data = JSON.parse(text)

      // Support both raw notes array and exported format with { notes: [...] }
      const notes = Array.isArray(data) ? data : data.notes
      if (!notes || !Array.isArray(notes)) {
        throw new Error('Invalid JSON format: expected array of notes or { notes: [...] }')
      }

      pianoRollPlugin.loadNotes(notes)

      const infoEl = document.getElementById('note-info')
      if (infoEl) {
        infoEl.textContent = `Loading JSON: ${file.name}...`
      }
    } catch (error) {
      console.error('Failed to load JSON:', error)
      const infoEl = document.getElementById('note-info')
      if (infoEl) {
        infoEl.textContent = `Error loading JSON: ${error}`
      }
    }
  })
}

// Initialize
initWaveSurfer()
setupFileInputs()
