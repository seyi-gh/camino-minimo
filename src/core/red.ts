/**
 * red.ts
 *
 * Red vial dirigida de Lima en formato CSR (compressed sparse row).
 *
 * La matriz de adyacencia del modo academico tiene n^2 celdas; para la red
 * real, con cientos de miles de vertices, eso seria inviable. El formato CSR
 * guarda solo las aristas que existen: las salientes del vertice u ocupan
 * las posiciones desplazamientos[u] .. desplazamientos[u + 1] - 1.
 *
 * El archivo red.bin lo produce datos/construir_red.py.
 */

export interface RedVial {
  vertices: number
  aristas: number
  tramos: number
  /** Esquina suroeste del recuadro; las coordenadas se guardan relativas a ella. */
  base: [number, number]
  clases: string[]
  /** Pares (lon, lat) relativos a base, por vertice. */
  coordenadas: Float32Array
  desplazamientos: Int32Array
  destinos: Int32Array
  /** Indice del tramo de cada arista; el bit 30 indica sentido invertido. */
  tramoDeArista: Int32Array
  /** Por tramo: longitud en metros. */
  largo: Float32Array
  clase: Uint8Array
  banderas: Uint8Array
  /** Velocidad maxima declarada en OSM (km/h), 0 si falta el dato. */
  velocidad: Uint8Array
  nombre: Int32Array
  geoDesplazamientos: Int32Array
  /** Puntos (lon, lat) relativos a base de todas las geometrias de tramo. */
  geometria: Float32Array
}

export const BIT_INVERTIDA = 1 << 30
export const MASCARA_TRAMO = BIT_INVERTIDA - 1

export const TIENE_VELOCIDAD = 1
export const TIENE_CARRILES = 2
export const TIENE_SUPERFICIE = 4
export const TIENE_NOMBRE = 8
export const NO_PAVIMENTADA = 16

const TIPOS = {
  float32: Float32Array,
  int32: Int32Array,
  uint8: Uint8Array
} as const

interface Cabecera {
  version: number
  base: [number, number]
  vertices: number
  aristas: number
  tramos: number
  clases: string[]
  partes: { nombre: string; tipo: keyof typeof TIPOS; inicio: number; largo: number }[]
}

/** Interpreta el contenido de red.bin. No copia datos: las vistas apuntan al buffer. */
export function leerRed(buffer: ArrayBuffer): RedVial {
  const vista = new DataView(buffer)
  const magia = String.fromCharCode(
    vista.getUint8(0),
    vista.getUint8(1),
    vista.getUint8(2),
    vista.getUint8(3)
  )
  if (magia !== 'RVL1') {
    throw new Error('El archivo no es una red vial valida.')
  }
  const largoCabecera = vista.getUint32(4, true)
  const cabecera = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 8, largoCabecera))
  ) as Cabecera
  const inicioCuerpo = 8 + largoCabecera

  const partes: Record<string, Float32Array | Int32Array | Uint8Array> = {}
  for (const parte of cabecera.partes) {
    const Tipo = TIPOS[parte.tipo]
    if (!Tipo) {
      throw new Error('Tipo de dato desconocido en la red: ' + parte.tipo)
    }
    partes[parte.nombre] = new Tipo(buffer, inicioCuerpo + parte.inicio, parte.largo)
  }

  return {
    vertices: cabecera.vertices,
    aristas: cabecera.aristas,
    tramos: cabecera.tramos,
    base: cabecera.base,
    clases: cabecera.clases,
    coordenadas: partes.vertices as Float32Array,
    desplazamientos: partes.desplazamientos as Int32Array,
    destinos: partes.destinos as Int32Array,
    tramoDeArista: partes.tramos as Int32Array,
    largo: partes.largo as Float32Array,
    clase: partes.clase as Uint8Array,
    banderas: partes.banderas as Uint8Array,
    velocidad: partes.velocidad as Uint8Array,
    nombre: partes.nombre as Int32Array,
    geoDesplazamientos: partes.geoDesplazamientos as Int32Array,
    geometria: partes.geometria as Float32Array
  }
}

/** Longitud y latitud absolutas de un vertice. */
export function coordenada(red: RedVial, v: number): [number, number] {
  return [red.coordenadas[2 * v] + red.base[0], red.coordenadas[2 * v + 1] + red.base[1]]
}

/**
 * Red inversa: misma red con todas las aristas dadas vuelta. Dijkstra sobre
 * ella desde un hospital da el tiempo desde cada punto hacia ese hospital.
 */
export function invertir(red: RedVial): RedVial {
  const n = red.vertices
  const m = red.aristas
  const cuenta = new Int32Array(n + 1)
  for (let u = 0; u < n; u++) {
    for (let k = red.desplazamientos[u]; k < red.desplazamientos[u + 1]; k++) {
      cuenta[red.destinos[k] + 1]++
    }
  }
  for (let v = 0; v < n; v++) {
    cuenta[v + 1] += cuenta[v]
  }
  const desplazamientos = cuenta.slice()
  const cursor = cuenta.slice(0, n)
  const destinos = new Int32Array(m)
  const tramoDeArista = new Int32Array(m)
  for (let u = 0; u < n; u++) {
    for (let k = red.desplazamientos[u]; k < red.desplazamientos[u + 1]; k++) {
      const v = red.destinos[k]
      const p = cursor[v]++
      destinos[p] = u
      // La arista inversa recorre el mismo tramo en sentido contrario.
      tramoDeArista[p] = red.tramoDeArista[k] ^ BIT_INVERTIDA
    }
  }
  return { ...red, desplazamientos, destinos, tramoDeArista }
}

/**
 * Vertice de la red mas cercano a un punto. Busqueda lineal: con unos
 * cientos de miles de vertices tarda pocos milisegundos y no necesita indice.
 */
export function verticeMasCercano(red: RedVial, lon: number, lat: number): number {
  const x = lon - red.base[0]
  const y = lat - red.base[1]
  const escala = Math.cos((lat * Math.PI) / 180)
  let mejor = -1
  let menor = Infinity
  for (let v = 0; v < red.vertices; v++) {
    const dx = (red.coordenadas[2 * v] - x) * escala
    const dy = red.coordenadas[2 * v + 1] - y
    const d = dx * dx + dy * dy
    if (d < menor) {
      menor = d
      mejor = v
    }
  }
  return mejor
}
