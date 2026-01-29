import type { UserConfig } from 'vite'
import path from 'path'
import dts from 'vite-plugin-dts'
export default {
    plugins: [dts({ rollupTypes: true })],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        }
    },
    build: {
        lib: {
            entry: path.resolve(__dirname, './src/index.ts'),
            name: 'pianoRollPlugin',
            fileName: (format) => `piano-roll-plugin.${format}.js`
        },

    }
} satisfies UserConfig