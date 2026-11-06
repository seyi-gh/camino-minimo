/**
 * sistema.ts
 *
 * Verificacion del motor de despacho sobre la red vial real de Lima.
 *
 *   1. El monticulo extrae en orden no decreciente.
 *   2. El Dijkstra con sumidero elige lo mismo que la fuerza bruta: correr
 *      un Dijkstra completo y probar cada hospital uno por uno.
 *   3. La red inversa da los mismos tiempos que la red directa.
 *   4. En el grafo reducido de 15 vertices, el camino de EMG a S coincide
 *      con el minimo de (camino a cada hospital + su espera).
 *   5. El grafo de vecindad relativa es simetrico y conexo.
 *
 *   node pruebas/sistema.ts
 */

import { readFileSync } from 'node:fs'
import { crearGenerador } from '../src/core/aleatorio.ts'
import { ESCENARIO_BASE, pesosDeRed } from '../src/core/costos.ts'
import {
  type Hospital,
  type TipoEmergencia,
  despachar,
  elegibles,
  esperaEstimada,
  tiemposDesde
} from '../src/core/despacho.ts'
import { dijkstra } from '../src/core/dijkstra.ts'
import { construirPesos } from '../src/core/grafo.ts'
import { Monticulo } from '../src/core/monticulo.ts'
import { invertir, leerRed } from '../src/core/red.ts'
import { agregarSumidero, simetrizar, vecindadRelativa } from '../src/core/reduccion.ts'

let fallos = 0
function comprobar(condicion: boolean, mensaje: string): void {
  if (!condicion) {
    fallos++
    console.error('  FALLO: ' + mensaje)
  }
}
function cerca(a: number, b: number, tolerancia = 1e-3): boolean {
  return Math.abs(a - b) <= tolerancia * Math.max(1, Math.abs(a), Math.abs(b))
}

const azar = crearGenerador(475)

// ------------------------------------------------------------------ 1
{
  const m = new Monticulo(4)
  const valores: number[] = []
  for (let i = 0; i < 5000; i++) {
    const p = Math.floor(azar() * 1000)
    valores.push(p)
    m.insertar(i, p)
  }
  let previo = -Infinity
  let ordenado = true
  let extraidos = 0
  while (!m.vacio) {
    const p = m.prioridadMinima
    m.extraer()
    if (p < previo) ordenado = false
    previo = p
    extraidos++
  }
  comprobar(ordenado && extraidos === 5000, 'el monticulo no extrae en orden')
  console.log(`1. Monticulo: 5000 extracciones en orden no decreciente.`)
}

// ------------------------------------------------------------------ datos reales
const bytes = readFileSync('public/datos/red.bin')
const red = leerRed(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
const hospitales: Hospital[] = JSON.parse(readFileSync('public/datos/hospitales.json', 'utf8')).hospitales
const TIPOS: TipoEmergencia[] = ['trauma', 'cardiaca', 'respiratoria', 'obstetrica', 'pediatrica', 'general']

// ------------------------------------------------------------------ 2
{
  const horas = [3, 8, 13, 19]
  let casos = 0
  for (const hora of horas) {
    const pesos = pesosDeRed(red, { ...ESCENARIO_BASE, hora })
    for (let c = 0; c < 10; c++) {
      const origen = Math.floor(azar() * red.vertices)
      const tipo = TIPOS[Math.floor(azar() * TIPOS.length)]
      const ocup = hospitales.map(() => 0.3 + azar() * 0.69)
      const lista = elegibles(hospitales, tipo)
      const candidatos = lista.map((i) => ({ hospital: i, espera: esperaEstimada(ocup[i]) }))

      const r = despachar(red, pesos, origen, hospitales, candidatos)
      const todos = tiemposDesde(red, pesos, origen)
      let mejor = Infinity
      for (const i of lista) mejor = Math.min(mejor, todos[hospitales[i].vertice] + esperaEstimada(ocup[i]))

      comprobar(cerca(r.total, mejor), `hora ${hora}, origen ${origen}: sumidero ${r.total} vs fuerza bruta ${mejor}`)
      // La ruta devuelta cuesta exactamente el viaje reportado.
      let costoRuta = 0
      for (const k of r.aristasCamino) costoRuta += pesos[k]
      comprobar(cerca(costoRuta, r.viaje), `la ruta no suma el viaje reportado (${costoRuta} vs ${r.viaje})`)
      comprobar(r.camino[0] === origen, 'la ruta no empieza en el origen')
      comprobar(r.camino[r.camino.length - 1] === hospitales[r.hospital].vertice, 'la ruta no termina en el hospital')
      casos++
    }
  }
  console.log(`2. Sumidero virtual = fuerza bruta en ${casos} despachos aleatorios (4 franjas horarias).`)
}

// ------------------------------------------------------------------ 3
{
  const pesos = pesosDeRed(red, ESCENARIO_BASE)
  const inversa = invertir(red)
  const pesosInv = pesosDeRed(inversa, ESCENARIO_BASE)
  let pares = 0
  for (const h of hospitales.slice(0, 4)) {
    const haciaH = tiemposDesde(inversa, pesosInv, h.vertice)
    for (let c = 0; c < 5; c++) {
      const v = Math.floor(azar() * red.vertices)
      const desdeV = tiemposDesde(red, pesos, v)
      comprobar(cerca(haciaH[v], desdeV[h.vertice]), `red inversa: ${haciaH[v]} vs ${desdeV[h.vertice]}`)
      pares++
    }
  }
  console.log(`3. Red inversa coherente con la directa en ${pares} pares punto-hospital.`)
}

// ------------------------------------------------------------------ 4 y 5
{
  let casos = 0
  for (let c = 0; c < 30; c++) {
    const n = 14
    // Puntos al azar en un plano: tiempos euclidianos con asimetria leve.
    const xs = Array.from({ length: n }, () => [azar() * 30, azar() * 30])
    const seg = xs.map((a) => xs.map((b) => 60 * Math.hypot(a[0] - b[0], a[1] - b[1]) * (0.9 + azar() * 0.2)))
    seg.forEach((fila, i) => (fila[i] = 0))
    const w = simetrizar(seg)
    const base = vecindadRelativa(w)

    let simetrica = true
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (base[i][j] !== base[j][i]) simetrica = false
    comprobar(simetrica, 'el grafo de vecindad relativa no es simetrico')

    // dijkstra() se detiene al cerrar el destino; aqui se necesitan todas las etiquetas.
    const completo = dijkstraCompleto(construirPesos(base), 0)
    comprobar(completo.every(Number.isFinite), 'el grafo de vecindad relativa no es conexo')

    const hosp = [1, 2, 3, 4, 5]
    const esperas = Array.from({ length: n }, (_, i) => (hosp.includes(i) ? 1 + Math.round(azar() * 60) : null))
    const conS = agregarSumidero(base, esperas)
    const r = dijkstra(construirPesos(conS), 0, n)
    let mejor = Infinity
    for (const h of hosp) mejor = Math.min(mejor, completo[h] + (esperas[h] as number))
    comprobar(r.costoTotal === mejor, `grafo reducido: EMG->S ${r.costoTotal} vs minimo por hospital ${mejor}`)
    comprobar(conS.length === 15, 'el grafo reducido no tiene 15 vertices')
    casos++
  }
  console.log(`4. Grafo reducido de 15 vertices: camino a S = mejor hospital en ${casos} casos.`)
  console.log(`5. Vecindad relativa simetrica y conexa en ${casos} casos.`)
}

function dijkstraCompleto(pesos: number[][], origen: number): number[] {
  const n = pesos.length
  const d = new Array(n).fill(Infinity)
  const listo = new Array(n).fill(false)
  d[origen] = 0
  for (let it = 0; it < n; it++) {
    let u = -1
    for (let v = 0; v < n; v++) if (!listo[v] && (u === -1 || d[v] < d[u])) u = v
    if (u === -1 || !Number.isFinite(d[u])) break
    listo[u] = true
    for (let v = 0; v < n; v++) if (Number.isFinite(pesos[u][v]) && d[u] + pesos[u][v] < d[v]) d[v] = d[u] + pesos[u][v]
  }
  return d
}

if (fallos > 0) {
  console.error(`\n${fallos} comprobaciones fallaron.`)
  process.exit(1)
}
console.log('\nTodas las comprobaciones pasaron.')
