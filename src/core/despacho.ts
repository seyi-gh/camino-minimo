/**
 * despacho.ts
 *
 * Eleccion del hospital y de la ruta para una emergencia, con un solo
 * Dijkstra.
 *
 * La pregunta del SAMU no es "cual es el camino mas corto al hospital X",
 * sino "a que hospital conviene ir". Resolverla con un Dijkstra por hospital
 * costaria H ejecuciones. En su lugar se agrega a la red un vertice virtual,
 * el sumidero S, y una arista de cada hospital elegible h hacia S cuyo peso
 * es la espera estimada en h:
 *
 *     costo(origen -> S) = min_h [ viaje(origen -> h) + espera(h) ]
 *
 * Como todos los pesos son no negativos, Dijkstra sigue siendo correcto en
 * la red ampliada, y la primera vez que extrae a S ya tiene el optimo: elige
 * hospital y ruta a la vez, y se detiene sin explorar mas alla.
 */

import { Monticulo } from './monticulo.ts'
import type { RedVial } from './red.ts'

export type TipoEmergencia =
  | 'trauma'
  | 'cardiaca'
  | 'respiratoria'
  | 'obstetrica'
  | 'pediatrica'
  | 'general'

export interface Hospital {
  id: string
  nombre: string
  nombreCorto: string
  /** Vertice de la red donde se ubica la puerta de emergencia. */
  vertice: number
  lon: number
  lat: number
  /** Nivel de complejidad: 2 (II-1, II-2) o 3 (III-1, III-2, III-E). */
  nivel: 2 | 3
  /** Atenciones que el servicio de emergencia completa por hora. */
  capacidadHora: number
  /** Tipos de emergencia que resuelve. */
  atiende: TipoEmergencia[]
  red: string
}

/** Tiempo medio de atencion inicial en emergencia, en segundos. */
export const TIEMPO_ATENCION = 8 * 60

/** Por encima de esta ocupacion el servicio se declara saturado. */
export const OCUPACION_SATURADA = 0.97

/**
 * Espera esperada en la cola de emergencia, en segundos.
 *
 * Se aproxima el servicio como una cola M/M/1 con factor de utilizacion
 * rho (ocupacion): la espera media en cola es Wq = (1/mu) * rho / (1 - rho).
 * La espera crece lentamente hasta ~70 % y se dispara al acercarse al 100 %,
 * que es lo que se observa en las emergencias saturadas.
 */
export function esperaEstimada(ocupacion: number): number {
  const rho = Math.min(Math.max(ocupacion, 0), OCUPACION_SATURADA)
  return (TIEMPO_ATENCION * rho) / (1 - rho)
}

export interface Candidato {
  hospital: number
  espera: number
}

export interface OpcionesDespacho {
  /** Si es true, registra el orden en que se asientan los vertices (para animar). */
  registrar?: boolean
}

export interface ResultadoDespacho {
  origen: number
  /** Indice del hospital elegido en la lista de entrada; -1 si ninguno es alcanzable. */
  hospital: number
  viaje: number
  espera: number
  total: number
  /** Vertices de la ruta, del origen a la puerta del hospital. */
  camino: number[]
  /** Aristas (indices CSR) de la ruta, en orden. */
  aristasCamino: number[]
  /**
   * Llegada a cada hospital elegible asentado antes de detenerse; Infinity si no
   * se alcanzo o si no era elegible para el tipo de emergencia.
   */
  llegadas: Float64Array
  /** Etiqueta definitiva de cada vertice asentado; Infinity si no se asento. */
  distancias: Float32Array
  /** Vertices en el orden en que se declararon definitivos (si registrar). */
  orden: Int32Array
  asentados: number
  relajaciones: number
  milisegundos: number
}

/**
 * Dijkstra con sumidero virtual desde el punto de la emergencia.
 *
 * candidatos: hospitales elegibles para el tipo de emergencia y su espera.
 */
export function despachar(
  red: RedVial,
  pesos: Float32Array,
  origen: number,
  hospitales: Hospital[],
  candidatos: Candidato[],
  opciones: OpcionesDespacho = {}
): ResultadoDespacho {
  const inicio = performance.now()
  const n = red.vertices
  const S = n

  // Espera minima por vertice: dos hospitales pueden caer en el mismo vertice.
  const esperaEn = new Map<number, Candidato>()
  for (const c of candidatos) {
    const v = hospitales[c.hospital].vertice
    const previo = esperaEn.get(v)
    if (!previo || c.espera < previo.espera) {
      esperaEn.set(v, c)
    }
  }

  const dist = new Float64Array(n + 1).fill(Infinity)
  const predArista = new Int32Array(n).fill(-1)
  const predVertice = new Int32Array(n + 1).fill(-1)
  const definitivo = new Uint8Array(n + 1)
  const distancias = new Float32Array(n).fill(Infinity)
  const orden = opciones.registrar ? new Int32Array(n) : new Int32Array(0)
  const llegadas = new Float64Array(hospitales.length).fill(Infinity)
  let sumideroVia: Candidato | null = null

  const cola = new Monticulo(4096)
  dist[origen] = 0
  cola.insertar(origen, 0)

  let asentados = 0
  let relajaciones = 0

  while (!cola.vacio) {
    const prioridad = cola.prioridadMinima
    const u = cola.extraer()
    if (definitivo[u] || prioridad > dist[u]) {
      continue // entrada vieja de la insercion perezosa
    }
    definitivo[u] = 1

    if (u === S) {
      break // el sumidero salio de la cola: el optimo esta decidido
    }

    distancias[u] = dist[u]
    if (opciones.registrar) {
      orden[asentados] = u
    }
    asentados++

    const candidato = esperaEn.get(u)
    if (candidato) {
      for (const c of candidatos) {
        if (hospitales[c.hospital].vertice === u) {
          llegadas[c.hospital] = dist[u]
        }
      }
      const total = dist[u] + candidato.espera
      if (total < dist[S]) {
        dist[S] = total
        predVertice[S] = u
        sumideroVia = candidato
        cola.insertar(S, total)
      }
    }

    const du = dist[u]
    for (let k = red.desplazamientos[u]; k < red.desplazamientos[u + 1]; k++) {
      const v = red.destinos[k]
      if (definitivo[v]) {
        continue
      }
      const candidata = du + pesos[k]
      if (candidata < dist[v]) {
        dist[v] = candidata
        predVertice[v] = u
        predArista[v] = k
        cola.insertar(v, candidata)
        relajaciones++
      }
    }
  }

  const camino: number[] = []
  const aristasCamino: number[] = []
  let hospital = -1
  let viaje = Infinity
  let espera = Infinity

  if (sumideroVia && Number.isFinite(dist[S])) {
    hospital = sumideroVia.hospital
    espera = sumideroVia.espera
    const puerta = predVertice[S]
    viaje = dist[puerta]
    let v = puerta
    while (v !== -1) {
      camino.push(v)
      if (predArista[v] !== -1) {
        aristasCamino.push(predArista[v])
      }
      v = v === origen ? -1 : predVertice[v]
    }
    camino.reverse()
    aristasCamino.reverse()
  }

  return {
    origen,
    hospital,
    viaje,
    espera,
    total: viaje + espera,
    camino,
    aristasCamino,
    llegadas,
    distancias,
    orden: opciones.registrar ? orden.subarray(0, asentados) : orden,
    asentados,
    relajaciones,
    milisegundos: performance.now() - inicio
  }
}

/**
 * Dijkstra completo sin sumidero: tiempo desde la fuente a todos los vertices.
 * Sobre la red inversa y desde un hospital, da el tiempo desde cualquier
 * punto de Lima hacia ese hospital. La simulacion lo precalcula una vez por
 * hospital y luego despacha cada emergencia en O(H) en lugar de O(m log n).
 */
export function tiemposDesde(red: RedVial, pesos: Float32Array, fuente: number): Float32Array {
  const n = red.vertices
  const dist = new Float32Array(n).fill(Infinity)
  const definitivo = new Uint8Array(n)
  const cola = new Monticulo(4096)
  dist[fuente] = 0
  cola.insertar(fuente, 0)
  while (!cola.vacio) {
    const prioridad = cola.prioridadMinima
    const u = cola.extraer()
    if (definitivo[u] || prioridad > dist[u]) {
      continue
    }
    definitivo[u] = 1
    const du = dist[u]
    for (let k = red.desplazamientos[u]; k < red.desplazamientos[u + 1]; k++) {
      const v = red.destinos[k]
      // Redondeo a Float32 antes de comparar: la etiqueta se guarda en Float32
      // y la prioridad en la cola debe ser exactamente el mismo valor, o la
      // entrada se confundiria con una vieja al extraerla.
      const candidata = Math.fround(du + pesos[k])
      if (candidata < dist[v]) {
        dist[v] = candidata
        cola.insertar(v, candidata)
      }
    }
  }
  return dist
}

/** Hospitales que pueden recibir una emergencia del tipo dado. */
export function elegibles(hospitales: Hospital[], tipo: TipoEmergencia): number[] {
  const lista: number[] = []
  hospitales.forEach((h, i) => {
    if (h.atiende.includes(tipo)) {
      lista.push(i)
    }
  })
  return lista
}
