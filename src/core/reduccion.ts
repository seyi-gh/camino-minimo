/**
 * reduccion.ts
 *
 * Reduccion del caso real a un grafo de a lo mas 15 vertices, el tamano
 * que exige el enunciado del proyecto.
 *
 * Se eligen puntos clave (la emergencia, los hospitales candidatos y los
 * distritos vecinos) y se mide, por la red vial real, el tiempo entre cada
 * par. Unir todos con todos daria un grafo completo en el que el camino
 * minimo seria casi siempre la arista directa: no habria nada que resolver.
 * Por eso se conserva solo el grafo de vecindad relativa: la arista {i, j}
 * se mantiene si no existe un tercer punto k mas cercano a ambos,
 *
 *     se elimina {i, j}  si  existe k:  max(w(i,k), w(k,j)) < w(i,j).
 *
 * Ese grafo es conexo (contiene al arbol de expansion minima) y disperso,
 * de modo que los caminos atraviesan puntos intermedios como en la ciudad.
 *
 * Finalmente se agrega el sumidero virtual S, unido a cada hospital con un
 * peso igual a su espera estimada: el camino minimo de la emergencia a S es
 * la decision completa del despacho.
 */

import type { MatrizEntrada } from './grafo.ts'

/**
 * Tiempo simetrico en minutos enteros (minimo 1) a partir de tiempos
 * dirigidos en segundos: la red real tiene sentidos unicos, el grafo del
 * enunciado es no dirigido, asi que se usa el promedio de ida y vuelta.
 */
export function simetrizar(segundos: number[][]): number[][] {
  const n = segundos.length
  const w: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ida = segundos[i][j]
      const vuelta = segundos[j][i]
      const promedio = (ida + vuelta) / 2
      const minutos = Number.isFinite(promedio) ? Math.max(1, Math.round(promedio / 60)) : 0
      w[i][j] = minutos
      w[j][i] = minutos
    }
  }
  return w
}

/** Grafo de vecindad relativa sobre una matriz simetrica de pesos (0 = sin arista). */
export function vecindadRelativa(w: number[][]): MatrizEntrada {
  const n = w.length
  const salida: MatrizEntrada = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!w[i][j]) continue
      let dominada = false
      for (let k = 0; k < n && !dominada; k++) {
        if (k === i || k === j || !w[i][k] || !w[k][j]) continue
        if (Math.max(w[i][k], w[k][j]) < w[i][j]) dominada = true
      }
      if (!dominada) {
        salida[i][j] = w[i][j]
        salida[j][i] = w[i][j]
      }
    }
  }
  return salida
}

/**
 * Agrega el sumidero como ultimo vertice. esperas[i] es la espera en
 * minutos del punto i si es un hospital elegible, o null si no lo es.
 */
export function agregarSumidero(matriz: MatrizEntrada, esperas: (number | null)[]): MatrizEntrada {
  const n = matriz.length
  const salida = matriz.map((fila) => [...fila, 0])
  salida.push(new Array(n + 1).fill(0))
  esperas.forEach((espera, i) => {
    if (espera === null) return
    // Peso no negativo y distinto de cero: 0 significa "sin arista" en la entrada.
    const peso = Math.max(1, Math.round(espera))
    salida[i][n] = peso
    salida[n][i] = peso
  })
  return salida
}
