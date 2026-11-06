/**
 * grafo.ts
 *
 * Construccion y validacion de la matriz de adyacencia ponderada.
 *
 * Este modulo no conoce el dominio de aplicacion: opera unicamente sobre
 * numeros. Un vertice es un indice y un peso es un numero no negativo.
 */

/** Limites de tamano establecidos por el enunciado del proyecto. */
export const MIN_VERTICES = 5
export const MAX_VERTICES = 15

/**
 * Valor que el usuario ingresa para indicar que no existe arista.
 * Internamente se traduce a Infinity al construir la matriz de pesos.
 */
export const SIN_ARISTA = 0

/** Matriz tal como la ingresa el usuario: 0 significa ausencia de arista. */
export type MatrizEntrada = number[][]

/** Matriz de trabajo: Infinity significa ausencia de arista. */
export type MatrizPesos = number[][]

export interface OpcionesValidacion {
  /** Exige que la matriz sea simetrica (grafo no dirigido). */
  exigirSimetria?: boolean
}

export interface ResultadoValidacion {
  valida: boolean
  errores: string[]
}

/** Crea una matriz de n x n llena de ceros. */
export function crearMatrizVacia(n: number): MatrizEntrada {
  const matriz: MatrizEntrada = []
  for (let i = 0; i < n; i++) {
    matriz.push(new Array(n).fill(0))
  }
  return matriz
}

/**
 * Valida una matriz de entrada contra todas las condiciones del enunciado.
 * Devuelve la lista completa de errores, no solo el primero, para que la
 * interfaz pueda mostrarlos todos de una vez.
 */
export function validarMatriz(
  matriz: MatrizEntrada,
  opciones: OpcionesValidacion = {}
): ResultadoValidacion {
  const exigirSimetria = opciones.exigirSimetria ?? true
  const errores: string[] = []

  if (!Array.isArray(matriz) || matriz.length === 0) {
    return { valida: false, errores: ['La matriz esta vacia.'] }
  }

  const n = matriz.length

  if (n < MIN_VERTICES || n > MAX_VERTICES) {
    errores.push(
      `El numero de vertices debe estar entre ${MIN_VERTICES} y ${MAX_VERTICES}. Se recibio ${n}.`
    )
  }

  for (let i = 0; i < n; i++) {
    if (!Array.isArray(matriz[i]) || matriz[i].length !== n) {
      errores.push(`La fila ${i + 1} no tiene ${n} elementos. La matriz debe ser cuadrada.`)
      continue
    }

    for (let j = 0; j < n; j++) {
      const valor = matriz[i][j]

      if (typeof valor !== 'number' || !Number.isFinite(valor)) {
        errores.push(`El valor en la posicion (${i + 1}, ${j + 1}) no es un numero valido.`)
        continue
      }

      // Condicion de no negatividad: sin ella Dijkstra no garantiza el optimo.
      if (valor < 0) {
        errores.push(
          `El peso en (${i + 1}, ${j + 1}) es negativo. Dijkstra exige pesos no negativos.`
        )
      }

      if (i === j && valor !== 0) {
        errores.push(`La diagonal debe ser cero. La posicion (${i + 1}, ${i + 1}) vale ${valor}.`)
      }

      if (exigirSimetria && i < j && valor !== matriz[j][i]) {
        errores.push(
          `La matriz no es simetrica: (${i + 1}, ${j + 1}) = ${valor} pero ` +
            `(${j + 1}, ${i + 1}) = ${matriz[j][i]}.`
        )
      }
    }
  }

  return { valida: errores.length === 0, errores }
}

/**
 * Traduce la matriz de entrada a la matriz de pesos de trabajo.
 *
 * La distincion importa: un peso cero es una conexion sin costo, mientras
 * que una arista inexistente es un desplazamiento imposible. El usuario
 * escribe 0 por comodidad y el programa lo interpreta como Infinity.
 */
export function construirPesos(matriz: MatrizEntrada): MatrizPesos {
  const n = matriz.length
  const pesos: MatrizPesos = []

  for (let i = 0; i < n; i++) {
    const fila: number[] = []
    for (let j = 0; j < n; j++) {
      if (i === j) {
        fila.push(0)
      } else if (matriz[i][j] === SIN_ARISTA) {
        fila.push(Infinity)
      } else {
        fila.push(matriz[i][j])
      }
    }
    pesos.push(fila)
  }

  return pesos
}

/** Indices de los vertices conectados directamente con u. */
export function vecinos(pesos: MatrizPesos, u: number): number[] {
  const lista: number[] = []
  for (let v = 0; v < pesos.length; v++) {
    if (v !== u && Number.isFinite(pesos[u][v])) {
      lista.push(v)
    }
  }
  return lista
}

/** Cuenta las aristas del grafo, sin contar dos veces las no dirigidas. */
export function contarAristas(pesos: MatrizPesos, noDirigido = true): number {
  const n = pesos.length
  let total = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && Number.isFinite(pesos[i][j])) {
        total++
      }
    }
  }
  return noDirigido ? total / 2 : total
}

/**
 * Etiquetas propias de los vertices. Cuando el grafo proviene del caso real
 * (puntos de Lima), cada vertice lleva un codigo corto en lugar de 'vk'.
 */
let etiquetasPropias: string[] | null = null

export function establecerEtiquetas(etiquetas: string[] | null): void {
  etiquetasPropias = etiquetas
}

/** Etiqueta legible de un vertice: el indice 0 se muestra como 'v1'. */
export function etiquetaVertice(indice: number): string {
  return etiquetasPropias?.[indice] ?? `v${indice + 1}`
}
