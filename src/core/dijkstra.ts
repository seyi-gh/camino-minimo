/**
 * dijkstra.ts
 *
 * Algoritmo de Dijkstra con registro de la traza paso a paso.
 *
 * El registro no es un extra: el enunciado exige mostrar el desarrollo del
 * algoritmo, asi que cada iteracion guarda el vertice que se declara
 * definitivo, el estado completo de las etiquetas y las relajaciones hechas.
 */

import { type MatrizPesos, vecinos } from './grafo.ts'

/** Sin predecesor asignado. */
export const SIN_PREDECESOR = -1

/** Una relajacion: la etiqueta de un vertice mejoro a traves de otro. */
export interface Actualizacion {
  vertice: number
  distanciaAnterior: number
  distanciaNueva: number
  via: number
}

/** Estado del algoritmo al cerrar una iteracion. */
export interface PasoTraza {
  iteracion: number
  verticeDefinitivo: number
  distanciaDefinitiva: number
  /** Copia de las etiquetas de todos los vertices al terminar la iteracion. */
  distancias: number[]
  actualizaciones: Actualizacion[]
}

export interface ResultadoDijkstra {
  origen: number
  destino: number
  /** Etiquetas finales. Infinity indica vertice inalcanzable. */
  distancias: number[]
  predecesores: number[]
  /** Etiquetas antes de la primera iteracion, para la fila 'Inicio'. */
  estadoInicial: number[]
  traza: PasoTraza[]
  /** Secuencia de vertices del camino minimo. Vacia si no hay camino. */
  camino: number[]
  /** Costo total del camino. Infinity si el destino es inalcanzable. */
  costoTotal: number
  alcanzable: boolean
  /** True si el algoritmo se detuvo al cerrar el destino. */
  terminoAnticipadamente: boolean
}

/**
 * Resuelve el camino minimo entre origen y destino.
 *
 * Precondicion: todos los pesos finitos son no negativos. La validacion
 * corresponde a grafo.validarMatriz y no se repite aqui, porque este modulo
 * asume una matriz ya validada.
 */
export function dijkstra(
  pesos: MatrizPesos,
  origen: number,
  destino: number
): ResultadoDijkstra {
  const n = pesos.length

  if (origen < 0 || origen >= n) {
    throw new RangeError(`Vertice de origen fuera de rango: ${origen}.`)
  }
  if (destino < 0 || destino >= n) {
    throw new RangeError(`Vertice de destino fuera de rango: ${destino}.`)
  }

  const distancias: number[] = new Array(n).fill(Infinity)
  const predecesores: number[] = new Array(n).fill(SIN_PREDECESOR)
  const definitivo: boolean[] = new Array(n).fill(false)

  distancias[origen] = 0

  const estadoInicial = [...distancias]
  const traza: PasoTraza[] = []
  let terminoAnticipadamente = false

  for (let iteracion = 1; iteracion <= n; iteracion++) {
    const u = verticeNoDefinitivoConMenorDistancia(distancias, definitivo)

    // No queda ningun vertice alcanzable: el grafo no es conexo.
    if (u === SIN_PREDECESOR) {
      break
    }

    definitivo[u] = true
    const actualizaciones: Actualizacion[] = []

    // Al cerrar el destino su etiqueta ya es definitiva, seguir no la cambia.
    if (u === destino) {
      traza.push({
        iteracion,
        verticeDefinitivo: u,
        distanciaDefinitiva: distancias[u],
        distancias: [...distancias],
        actualizaciones
      })
      terminoAnticipadamente = true
      break
    }

    for (const v of vecinos(pesos, u)) {
      if (definitivo[v]) {
        continue
      }

      const candidata = distancias[u] + pesos[u][v]

      if (candidata < distancias[v]) {
        actualizaciones.push({
          vertice: v,
          distanciaAnterior: distancias[v],
          distanciaNueva: candidata,
          via: u
        })
        distancias[v] = candidata
        predecesores[v] = u
      }
    }

    traza.push({
      iteracion,
      verticeDefinitivo: u,
      distanciaDefinitiva: distancias[u],
      distancias: [...distancias],
      actualizaciones
    })
  }

  const alcanzable = Number.isFinite(distancias[destino])
  const camino = alcanzable ? reconstruirCamino(predecesores, origen, destino) : []

  return {
    origen,
    destino,
    distancias,
    predecesores,
    estadoInicial,
    traza,
    camino,
    costoTotal: distancias[destino],
    alcanzable,
    terminoAnticipadamente
  }
}

/**
 * Selecciona el vertice no definitivo con la menor etiqueta.
 * Devuelve SIN_PREDECESOR si todos los restantes son inalcanzables.
 */
function verticeNoDefinitivoConMenorDistancia(
  distancias: number[],
  definitivo: boolean[]
): number {
  let mejor = SIN_PREDECESOR
  let menor = Infinity

  for (let v = 0; v < distancias.length; v++) {
    if (!definitivo[v] && distancias[v] < menor) {
      menor = distancias[v]
      mejor = v
    }
  }

  return mejor
}

/**
 * Reconstruye el camino recorriendo el arreglo de predecesores desde el
 * destino hacia atras y luego invirtiendo la secuencia.
 */
export function reconstruirCamino(
  predecesores: number[],
  origen: number,
  destino: number
): number[] {
  const camino: number[] = []
  let actual = destino
  const limite = predecesores.length + 1
  let pasos = 0

  while (actual !== SIN_PREDECESOR && pasos < limite) {
    camino.push(actual)
    if (actual === origen) {
      return camino.reverse()
    }
    actual = predecesores[actual]
    pasos++
  }

  return []
}

/** Costo de un camino dado, util para verificar el resultado de forma independiente. */
export function costoDeCamino(pesos: MatrizPesos, camino: number[]): number {
  let total = 0
  for (let i = 0; i < camino.length - 1; i++) {
    const peso = pesos[camino[i]][camino[i + 1]]
    if (!Number.isFinite(peso)) {
      return Infinity
    }
    total += peso
  }
  return total
}
