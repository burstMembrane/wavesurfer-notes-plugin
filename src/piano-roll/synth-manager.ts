import * as Tone from 'tone'
import type { PianoRollNote } from './types'
import { pitchToNoteName } from './note-utils'

/** Available synth types for preview */
export type PreviewSynthType = 'sine' | 'synth' | 'piano'

/**
 * Manages audio synthesis for note preview playback.
 * Handles multiple synth types and tracks playing notes.
 */
export class SynthManager {
    private sineSynth: Tone.PolySynth | null = null
    private triangleSynth: Tone.PolySynth | null = null
    private pianoSynth: Tone.PolySynth | null = null
    private playingNotes: Set<string> = new Set()
    private currentSynthType: PreviewSynthType = 'synth'
    private _enabled = false

    get enabled(): boolean {
        return this._enabled
    }

    get synthType(): PreviewSynthType {
        return this.currentSynthType
    }

    /**
     * Toggle preview on/off
     */
    async togglePreview(): Promise<boolean> {
        this._enabled = !this._enabled

        if (this._enabled) {
            await Tone.start()
            await this.initCurrentSynth()
        } else {
            this.stopAllNotes()
        }

        return this._enabled
    }

    /**
     * Set preview enabled state directly
     */
    async setEnabled(enabled: boolean): Promise<void> {
        if (enabled === this._enabled) return

        this._enabled = enabled
        if (enabled) {
            await Tone.start()
            await this.initCurrentSynth()
        } else {
            this.stopAllNotes()
        }
    }

    /**
     * Set the synth type
     */
    async setSynthType(type: PreviewSynthType): Promise<void> {
        if (type === this.currentSynthType) return

        this.stopAllNotes()
        this.currentSynthType = type

        if (this._enabled) {
            await this.initCurrentSynth()
        }
    }

    /**
     * Initialize the current synth type
     */
    private async initCurrentSynth(): Promise<void> {
        switch (this.currentSynthType) {
            case 'sine':
                if (!this.sineSynth) {
                    this.sineSynth = new Tone.PolySynth(Tone.Synth, {
                        oscillator: { type: 'sine' },
                        envelope: {
                            attack: 0.02,
                            decay: 0.1,
                            sustain: 0.5,
                            release: 0.3,
                        },
                    }).toDestination()
                    this.sineSynth.volume.value = -12
                }
                break
            case 'synth':
                if (!this.triangleSynth) {
                    this.triangleSynth = new Tone.PolySynth(Tone.Synth, {
                        oscillator: { type: 'triangle' },
                        envelope: {
                            attack: 0.02,
                            decay: 0.1,
                            sustain: 0.3,
                            release: 0.3,
                        },
                    }).toDestination()
                    this.triangleSynth.volume.value = -12
                }
                break
            case 'piano':
                if (!this.pianoSynth) {
                    this.pianoSynth = new Tone.PolySynth(Tone.FMSynth, {
                        harmonicity: 3,
                        modulationIndex: 10,
                        oscillator: { type: 'sine' },
                        envelope: {
                            attack: 0.001,
                            decay: 0.4,
                            sustain: 0.1,
                            release: 1.2,
                        },
                        modulation: { type: 'square' },
                        modulationEnvelope: {
                            attack: 0.002,
                            decay: 0.2,
                            sustain: 0,
                            release: 0.2,
                        },
                    }).toDestination()
                    this.pianoSynth.volume.value = -8
                }
                break
        }
    }

    /**
     * Trigger a note on the preview synth
     */
    triggerNote(note: PianoRollNote): void {
        if (!this._enabled) return

        const noteId = `${note.pitch}-${note.onset}`
        if (this.playingNotes.has(noteId)) return
        this.playingNotes.add(noteId)

        const freq = Tone.Frequency(note.pitch, 'midi').toFrequency()

        switch (this.currentSynthType) {
            case 'sine':
                this.sineSynth?.triggerAttack(freq, Tone.now(), note.velocity)
                break
            case 'synth':
                this.triangleSynth?.triggerAttack(freq, Tone.now(), note.velocity)
                break
            case 'piano':
                this.pianoSynth?.triggerAttack(freq, Tone.now(), note.velocity)
                break
        }
    }

    /**
     * Release a note on the preview synth
     */
    releaseNote(note: PianoRollNote): void {
        const noteId = `${note.pitch}-${note.onset}`
        if (!this.playingNotes.has(noteId)) return
        this.playingNotes.delete(noteId)

        const freq = Tone.Frequency(note.pitch, 'midi').toFrequency()

        switch (this.currentSynthType) {
            case 'sine':
                this.sineSynth?.triggerRelease(freq, Tone.now())
                break
            case 'synth':
                this.triangleSynth?.triggerRelease(freq, Tone.now())
                break
            case 'piano':
                this.pianoSynth?.triggerRelease(freq, Tone.now())
                break
        }
    }

    /**
     * Stop all preview notes
     */
    stopAllNotes(): void {
        this.sineSynth?.releaseAll()
        this.triangleSynth?.releaseAll()
        this.pianoSynth?.releaseAll()
        this.playingNotes.clear()
    }

    /**
     * Preview a pitch during drag operation (short duration)
     */
    previewPitch(pitch: number, durationMs = 200): void {
        if (!this._enabled) return

        const previewNote: PianoRollNote = {
            pitch,
            name: pitchToNoteName(pitch),
            onset: 0,
            offset: 0.3,
            duration: 0.3,
            velocity: 0.7,
            track: 0,
            channel: 0,
        }

        this.stopAllNotes()
        this.triggerNote(previewNote)

        setTimeout(() => {
            this.releaseNote(previewNote)
        }, durationMs)
    }

    /**
     * Dispose of all synths and clean up resources
     */
    dispose(): void {
        this.stopAllNotes()

        if (this.sineSynth) {
            this.sineSynth.dispose()
            this.sineSynth = null
        }
        if (this.triangleSynth) {
            this.triangleSynth.dispose()
            this.triangleSynth = null
        }
        if (this.pianoSynth) {
            this.pianoSynth.dispose()
            this.pianoSynth = null
        }

        this._enabled = false
    }
}
