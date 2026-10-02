/**
 * aleatorio.ts
 *
 * Generacion automatica de matrices de adyacencia ponderadas.
 *
 * Usa un generador con semilla en lugar de Math.random porque el informe
 * declara reproducibilidad: con la misma semilla el programa produce el
 * mismo grafo, y cualquiera puede repetir el resultado documentado.
 */

import { MAX_VERTICES, MIN_VERTICES, type MatrizEntrada, crearMatrizVacia } from './grafo.ts'

export interface OpcionesGeneracion {
  pesoMinimo?: number
  pesoMaximo?: number
  /** Probabilidad de incluir cada arista opcional, entre 0 y 1. */
  densidad?: number
  /** Si es true, garantiza que el grafo sea conexo. */
  garantizarConexo?: boolean
  /** Semilla para reproducir el mismo grafo. Si se omite se usa el reloj. */
  semilla?: number
}

/**
 * Generador congruencial mulberry32.
 * Pequeno, determinista y suficiente para grafos de prueba.
 */
export function crearGenerador(semilla: number): () => number {
  let estado = semilla >>> 0

  return function siguiente(): number {
    estado = (estado + 0x6d2b79f5) >>> 0
    let t = estado
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface GrafoGenerado {
  matriz: MatrizEntrada
  semilla: number
}

/**
 * Genera una matriz simetrica con pesos enteros no negativos.
 *
 * Cuando se pide conectividad, primero se construye un arbol de expansion
 * aleatorio que une todos los vertices y luego se agregan aristas extra
 * segun la densidad. Asi nunca se devuelve un grafo desconectado por azar.
 */
export function generarMatriz(n: number, opciones: OpcionesGeneracion = {}): GrafoGenerado {
  if (n < MIN_VERTICES || n > MAX_VERTICES) {
    throw new RangeError(
      `El numero de vertices debe estar entre ${MIN_VERTICES} y ${MAX_VERTICES}. Se recibio ${n}.`
    )
  }

  const pesoMinimo = opciones.pesoMinimo ?? 1
  const pesoMaximo = opciones.pesoMaximo ?? 20
  const densidad = opciones.densidad ?? 0.4
  const garantizarConexo = opciones.garantizarConexo ?? true
  const semilla = opciones.semilla ?? (Date.now() >>> 0)

  if (!Number.isFinite(pesoMinimo) || pesoMinimo < 1) {
    throw new RangeError('El peso mínimo debe ser al menos 1, porque 0 representa la ausencia de arista.')
  }
  if (!Number.isFinite(densidad) || densidad < 0 || densidad > 1) {
    throw new RangeError('La densidad debe estar entre 0 y 1.')
  }
  if (pesoMaximo < pesoMinimo) {
    throw new RangeError('El peso maximo no puede ser menor que el minimo.')
  }

  const azar = crearGenerador(semilla)
  const matriz = crearMatrizVacia(n)

  const pesoAleatorio = (): number => {
    return pesoMinimo + Math.floor(azar() * (pesoMaximo - pesoMinimo + 1))
  }

  const unir = (i: number, j: number, peso: number): void => {
    matriz[i][j] = peso
    matriz[j][i] = peso
  }

  if (garantizarConexo) {
    // Arbol de expansion: cada vertice nuevo se cuelga de uno ya conectado.
    for (let v = 1; v < n; v++) {
      const anterior = Math.floor(azar() * v)
      unir(v, anterior, pesoAleatorio())
    }
  }

  // Aristas adicionales segun la densidad pedida.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (matriz[i][j] === 0 && azar() < densidad) {
        unir(i, j, pesoAleatorio())
      }
    }
  }

  return { matriz, semilla }
}
