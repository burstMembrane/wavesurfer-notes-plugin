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
      <p class="text-gray-600 dark:text-gray-400 mb-6">Displaying vocadito_12 sample with piano roll visualization. Hold <kbd class="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-sm font-mono">Shift</kbd> and drag to select.</p>

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
    showSpectrogram: false,
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

// Initialize
initWaveSurfer()
