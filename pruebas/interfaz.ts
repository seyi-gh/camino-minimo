// Prueba de humo de la interfaz: monta el HTML real en jsdom, ejecuta main.ts
// y verifica que la pantalla quede con el ejemplo del informe ya resuelto.
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const html = readFileSync('./academico.html', 'utf8')
const dom = new JSDOM(html, { pretendToBeVisual: true })

const g = globalThis as Record<string, unknown>
g.window = dom.window
g.document = dom.window.document
g.SVGSVGElement = dom.window.SVGSVGElement
g.HTMLElement = dom.window.HTMLElement

await import('../src/ui/main.ts')

const doc = dom.window.document
const fallos: string[] = []

const camino = doc.querySelector('.resumen__camino')?.textContent ?? ''
if (camino !== 'v1 → v3 → v2 → v4 → v5') fallos.push('camino inesperado: ' + camino)

const detalle = doc.querySelector('.resumen__detalle')?.textContent ?? ''
if (!detalle.includes('Costo total 10')) fallos.push('costo inesperado: ' + detalle)

const filas = doc.querySelectorAll('.traza tbody tr').length
if (filas !== 6) fallos.push('la traza deberia tener 6 filas, tiene ' + filas)

const nodos = doc.querySelectorAll('.nodo').length
if (nodos !== 5) fallos.push('deberia dibujar 5 nodos, dibuja ' + nodos)

const aristasRuta = doc.querySelectorAll('.arista--ruta').length
if (aristasRuta !== 4) fallos.push('la ruta deberia tener 4 aristas, tiene ' + aristasRuta)

const celdasMatriz = doc.querySelectorAll('.matriz input').length
if (celdasMatriz !== 25) fallos.push('la matriz deberia tener 25 celdas, tiene ' + celdasMatriz)

// Simetria automatica al editar
const entradas = doc.querySelectorAll('.matriz input') as unknown as HTMLInputElement[]
const celda01 = entradas[1]
celda01.value = '7'
celda01.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
const celda10 = (doc.querySelectorAll('.matriz input') as unknown as HTMLInputElement[])[5]
if (celda10.value !== '7') fallos.push('la celda simetrica no se actualizo: ' + celda10.value)

console.log('camino:  ' + camino)
console.log('detalle: ' + detalle)
console.log('nodos:', nodos, '| aristas en ruta:', aristasRuta, '| filas de traza:', filas)

if (fallos.length) {
  console.log('\nFALLOS:'); fallos.forEach((f) => console.log('  - ' + f))
  throw new Error('prueba de humo fallida')
}
console.log('\nPrueba de humo de la interfaz: OK')
