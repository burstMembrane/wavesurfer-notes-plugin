import type { UserConfig } from 'vite'
import path from 'path'

export default {
    root: '.',
    publicDir: path.resolve(__dirname, './examples/assets/'),
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    build: {
        outDir: path.resolve(__dirname, './examples/dist'),
        emptyOutDir: true,
        rollupOptions: {
            input: path.resolve(__dirname, './index.html'),
            output: {
                dir: path.resolve(__dirname, './examples/dist'),
                entryFileNames: '[name]-[hash].js',
                assetFileNames: '[name]-[hash].[ext]'
            }
        },

    }
} satisfies UserConfig 