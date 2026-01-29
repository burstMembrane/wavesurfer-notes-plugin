/**
 * Spectrogram utilities for FFT calculation and rendering
 */

/**
 * Simple FFT implementation using the Cooley-Tukey algorithm
 */
export function fft(real: Float32Array, imag: Float32Array): void {
    const n = real.length

    if (n <= 1) return

    // Bit reversal permutation
    for (let i = 0, j = 0; i < n; i++) {
        if (i < j) {
            ;[real[i], real[j]] = [real[j], real[i]]
            ;[imag[i], imag[j]] = [imag[j], imag[i]]
        }
        let m = n >> 1
        while (m >= 1 && j >= m) {
            j -= m
            m >>= 1
        }
        j += m
    }

    // Cooley-Tukey FFT
    for (let mmax = 1; mmax < n; mmax <<= 1) {
        const theta = -Math.PI / mmax
        const wpr = Math.cos(theta)
        const wpi = Math.sin(theta)
        let wr = 1.0
        let wi = 0.0

        for (let m = 0; m < mmax; m++) {
            for (let i = m; i < n; i += mmax << 1) {
                const j = i + mmax
                const tr = wr * real[j] - wi * imag[j]
                const ti = wr * imag[j] + wi * real[j]
                real[j] = real[i] - tr
                imag[j] = imag[i] - ti
                real[i] += tr
                imag[i] += ti
            }
            const wtemp = wr
            wr = wr * wpr - wi * wpi
            wi = wi * wpr + wtemp * wpi
        }
    }
}

/**
 * Hann window function
 */
export function hannWindow(length: number): Float32Array {
    const window = new Float32Array(length)
    for (let i = 0; i < length; i++) {
        window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)))
    }
    return window
}

/**
 * Calculate spectrogram from audio buffer
 */
export function calculateSpectrogram(
    audioData: Float32Array,
    _sampleRate: number,
    fftSize: number,
    hopSize: number
): Float32Array[] {
    const window = hannWindow(fftSize)
    const spectrogram: Float32Array[] = []
    const numFrames = Math.floor((audioData.length - fftSize) / hopSize) + 1

    for (let frame = 0; frame < numFrames; frame++) {
        const start = frame * hopSize
        const real = new Float32Array(fftSize)
        const imag = new Float32Array(fftSize)

        // Apply window function
        for (let i = 0; i < fftSize; i++) {
            real[i] = (audioData[start + i] || 0) * window[i]
        }

        // Perform FFT
        fft(real, imag)

        // Calculate magnitudes (only first half due to symmetry)
        const magnitudes = new Float32Array(fftSize / 2)
        for (let i = 0; i < fftSize / 2; i++) {
            magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i])
        }

        spectrogram.push(magnitudes)
    }

    return spectrogram
}

/**
 * Convert frequency to bin index
 */
export function frequencyToBin(frequency: number, sampleRate: number, fftSize: number): number {
    return Math.round((frequency / sampleRate) * fftSize)
}

/**
 * Convert bin index to frequency
 */
export function binToFrequency(bin: number, sampleRate: number, fftSize: number): number {
    return (bin * sampleRate) / fftSize
}

/**
 * Color map types
 */
export type ColorMapType = 'default' | 'grayscale' | 'viridis'

/**
 * Get color from value (0-1) using specified color map
 */
export function getSpectrogramColor(value: number, colorMap: ColorMapType): [number, number, number] {
    value = Math.max(0, Math.min(1, value))

    switch (colorMap) {
        case 'grayscale': {
            const v = Math.floor(value * 255)
            return [v, v, v]
        }
        case 'viridis': {
            // Simplified viridis color map
            const r = Math.floor(68 + value * 185)
            const g = Math.floor(1 + value * 203)
            const b = Math.floor(84 + value * (253 - 84) * (1 - value * 0.5))
            return [
                Math.min(255, Math.max(0, r)),
                Math.min(255, Math.max(0, g)),
                Math.min(255, Math.max(0, b)),
            ]
        }
        case 'default':
        default: {
            // Purple/blue to orange/yellow gradient (similar to Ableton/DAW spectrograms)
            let r: number, g: number, b: number
            if (value < 0.25) {
                // Black to dark purple
                const t = value / 0.25
                r = Math.floor(t * 60)
                g = 0
                b = Math.floor(t * 100)
            } else if (value < 0.5) {
                // Dark purple to blue
                const t = (value - 0.25) / 0.25
                r = Math.floor(60 - t * 30)
                g = Math.floor(t * 80)
                b = Math.floor(100 + t * 155)
            } else if (value < 0.75) {
                // Blue to orange
                const t = (value - 0.5) / 0.25
                r = Math.floor(30 + t * 225)
                g = Math.floor(80 + t * 100)
                b = Math.floor(255 - t * 200)
            } else {
                // Orange to yellow/white
                const t = (value - 0.75) / 0.25
                r = 255
                g = Math.floor(180 + t * 75)
                b = Math.floor(55 + t * 200)
            }
            return [r, g, b]
        }
    }
}

/**
 * Convert Hz frequency to MIDI pitch
 */
export function hzToMidi(hz: number): number {
    return 69 + 12 * Math.log2(hz / 440)
}

/**
 * Convert MIDI pitch to Hz frequency
 */
export function midiToHz(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12)
}

/**
 * Render spectrogram to canvas ImageData with logarithmic frequency mapping
 * to align with piano roll pitch layout
 */
export function renderSpectrogramToImageData(
    spectrogram: Float32Array[],
    width: number,
    height: number,
    sampleRate: number,
    fftSize: number,
    frequencyMin: number,
    frequencyMax: number,
    colorMap: ColorMapType = 'default'
): ImageData {
    const imageData = new ImageData(width, height)
    const data = imageData.data

    if (spectrogram.length === 0) return imageData

    // Convert frequency range to MIDI pitch range
    // This allows us to use linear pitch mapping (matching the piano roll)
    const minPitch = hzToMidi(frequencyMin)
    const maxPitch = hzToMidi(frequencyMax)
    const pitchRange = maxPitch - minPitch

    // Calculate bin range for finding max magnitude
    const minBin = frequencyToBin(frequencyMin, sampleRate, fftSize)
    const maxBin = Math.min(frequencyToBin(frequencyMax, sampleRate, fftSize), fftSize / 2 - 1)

    // Find max magnitude for normalization
    let maxMag = 0
    for (const frame of spectrogram) {
        for (let bin = minBin; bin <= maxBin; bin++) {
            if (frame[bin] > maxMag) maxMag = frame[bin]
        }
    }

    // Convert to dB scale and normalize
    const minDb = -80
    const maxDb = 0
    const dbRange = maxDb - minDb

    for (let x = 0; x < width; x++) {
        // Map x to frame index
        const frameIndex = Math.floor((x / width) * spectrogram.length)
        const frame = spectrogram[Math.min(frameIndex, spectrogram.length - 1)]

        for (let y = 0; y < height; y++) {
            // Map y to MIDI pitch LINEARLY (high pitch at top, matching piano roll)
            // y=0 is top (high pitch), y=height is bottom (low pitch)
            const normalizedY = 1 - y / height
            const pitch = minPitch + normalizedY * pitchRange

            // Convert pitch to frequency (logarithmic relationship)
            const frequency = midiToHz(pitch)

            // Convert frequency to FFT bin
            const bin = Math.round((frequency / sampleRate) * fftSize)

            // Clamp bin to valid range
            const clampedBin = Math.max(0, Math.min(bin, frame.length - 1))

            // Get magnitude and convert to dB
            const magnitude = frame[clampedBin] || 0
            const db = magnitude > 0 ? 20 * Math.log10(magnitude / maxMag) : minDb
            const normalized = Math.max(0, (db - minDb) / dbRange)

            // Get color
            const [r, g, b] = getSpectrogramColor(normalized, colorMap)

            // Set pixel
            const idx = (y * width + x) * 4
            data[idx] = r
            data[idx + 1] = g
            data[idx + 2] = b
            data[idx + 3] = 255
        }
    }

    return imageData
}
