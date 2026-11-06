import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Dos paginas: el sistema de despacho (raiz) y el modo academico de la rubrica.
export default defineConfig({
  // MapLibre 6 carga su propio worker por ruta relativa al modulo; el
  // pre-empaquetado de Vite lo movia y el worker no se encontraba.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  build: {
    rollupOptions: {
      input: {
        sistema: resolve(import.meta.dirname, 'index.html'),
        academico: resolve(import.meta.dirname, 'academico.html')
      }
    }
  }
})
