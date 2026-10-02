/**
 * main.ts
 *
 * Orquestacion de la interfaz. Este archivo es el unico que conoce el DOM
 * y el estado de la pantalla al mismo tiempo; los modulos de core siguen
 * sin saber que existe un navegador.
 */

import {
  MAX_VERTICES,
  MIN_VERTICES,
  type MatrizEntrada,
  construirPesos,
  crearMatrizVacia,
  etiquetaVertice,
  validarMatriz
} from '../core/grafo.ts'
import { type ResultadoDijkstra, dijkstra } from '../core/dijkstra.ts'
import { generarMatriz } from '../core/aleatorio.ts'
import { dibujarMatriz, llenarSelectores, mostrarErrores } from './entrada.ts'
import { dibujarGrafo } from './grafoVista.ts'
import { dibujarTraza, limpiarTraza } from './trazaVista.ts'

/** Matriz del ejemplo resuelto a mano en el marco teorico del informe. */
const EJEMPLO_INFORME: MatrizEntrada = [
  [0, 4, 2, 0, 14],
  [4, 0, 1, 5, 20],
  [2, 1, 0, 8, 10],
  [0, 5, 8, 0, 2],
  [14, 20, 10, 2, 0]
]

interface Estado {
  matriz: MatrizEntrada
  resultado: ResultadoDijkstra | null
}

const estado: Estado = {
  matriz: crearMatrizVacia(5),
  resultado: null
}

function elemento<T extends HTMLElement>(id: string): T {
  const encontrado = document.getElementById(id)
  if (!encontrado) {
    throw new Error('Falta el elemento con id ' + id + ' en el documento.')
  }
  return encontrado as T
}

/** Los elementos SVG no heredan de HTMLElement, por eso llevan su propia busqueda. */
function elementoSvg(id: string): SVGSVGElement {
  const encontrado = document.getElementById(id)
  if (!(encontrado instanceof SVGSVGElement)) {
    throw new Error('Falta el elemento SVG con id ' + id + ' en el documento.')
  }
  return encontrado
}

const campoVertices = elemento<HTMLInputElement>('cantidadVertices')
const campoSemilla = elemento<HTMLInputElement>('semilla')
const campoDensidad = elemento<HTMLInputElement>('densidad')
const salidaDensidad = elemento<HTMLOutputElement>('densidadValor')
const botonGenerar = elemento<HTMLButtonElement>('botonGenerar')
const botonVaciar = elemento<HTMLButtonElement>('botonVaciar')
const botonEjemplo = elemento<HTMLButtonElement>('botonEjemplo')
const botonCalcular = elemento<HTMLButtonElement>('botonCalcular')
const contenedorMatriz = elemento<HTMLDivElement>('contenedorMatriz')
const contenedorErrores = elemento<HTMLDivElement>('errores')
const contenedorTraza = elemento<HTMLDivElement>('contenedorTraza')
const contenedorResumen = elemento<HTMLElement>('resumen')
const selectOrigen = elemento<HTMLSelectElement>('origen')
const selectDestino = elemento<HTMLSelectElement>('destino')
const lienzo = elementoSvg('lienzoGrafo')

/** Lee el numero de vertices pedido, recortado al rango del enunciado. */
function leerCantidadVertices(): number {
  const valor = Number(campoVertices.value)
  if (!Number.isFinite(valor)) {
    return MIN_VERTICES
  }
  return Math.min(MAX_VERTICES, Math.max(MIN_VERTICES, Math.round(valor)))
}

function establecerMatriz(nueva: MatrizEntrada): void {
  estado.matriz = nueva
  estado.resultado = null

  campoVertices.value = String(nueva.length)
  dibujarMatriz(contenedorMatriz, estado.matriz, alEditarMatriz)
  llenarSelectores(selectOrigen, selectDestino, nueva.length)
  limpiarTraza(contenedorTraza)
  limpiarResumen()
  refrescarGrafo()
  validar()
}

function alEditarMatriz(): void {
  estado.resultado = null
  limpiarTraza(contenedorTraza)
  limpiarResumen()
  refrescarGrafo()
  validar()
}

function validar(): boolean {
  const { valida, errores } = validarMatriz(estado.matriz)
  mostrarErrores(contenedorErrores, errores)
  botonCalcular.disabled = !valida
  return valida
}

function refrescarGrafo(): void {
  dibujarGrafo(lienzo, estado.matriz, {
    camino: estado.resultado?.camino ?? [],
    origen: Number(selectOrigen.value),
    destino: Number(selectDestino.value)
  })
}

function limpiarResumen(): void {
  contenedorResumen.replaceChildren()
  const aviso = document.createElement('p')
  aviso.className = 'resumen__vacio'
  aviso.textContent = 'Elige origen y destino, luego calcula el camino mínimo.'
  contenedorResumen.appendChild(aviso)
}

function mostrarResumen(resultado: ResultadoDijkstra): void {
  contenedorResumen.replaceChildren()

  if (!resultado.alcanzable) {
    const aviso = document.createElement('p')
    aviso.className = 'resumen__vacio'
    aviso.textContent =
      'No existe camino entre ' +
      etiquetaVertice(resultado.origen) +
      ' y ' +
      etiquetaVertice(resultado.destino) +
      '. Los dos vértices están en componentes conexas distintas.'
    contenedorResumen.appendChild(aviso)
    return
  }

  const camino = document.createElement('p')
  camino.className = 'resumen__camino'
  camino.textContent = resultado.camino.map(etiquetaVertice).join(' → ')
  contenedorResumen.appendChild(camino)

  const detalle = document.createElement('p')
  detalle.className = 'resumen__detalle'
  detalle.append(
    'Costo total ',
    conFuerza(String(resultado.costoTotal)),
    ' en ',
    conFuerza(String(resultado.camino.length - 1)),
    ' aristas, resuelto en ',
    conFuerza(String(resultado.traza.length)),
    ' iteraciones.'
  )
  contenedorResumen.appendChild(detalle)
}

function conFuerza(texto: string): HTMLElement {
  const marca = document.createElement('strong')
  marca.textContent = texto
  return marca
}

function calcular(): void {
  if (!validar()) {
    return
  }

  const origen = Number(selectOrigen.value)
  const destino = Number(selectDestino.value)

  if (origen === destino) {
    mostrarErrores(contenedorErrores, ['El origen y el destino deben ser vértices distintos.'])
    return
  }

  const pesos = construirPesos(estado.matriz)
  const resultado = dijkstra(pesos, origen, destino)

  estado.resultado = resultado
  refrescarGrafo()
  dibujarTraza(contenedorTraza, resultado)
  mostrarResumen(resultado)
}

botonGenerar.addEventListener('click', () => {
  const n = leerCantidadVertices()
  const semilla = Number(campoSemilla.value)

  const { matriz } = generarMatriz(n, {
    semilla: Number.isFinite(semilla) ? semilla : undefined,
    densidad: Number(campoDensidad.value),
    garantizarConexo: true
  })

  establecerMatriz(matriz)
})

botonVaciar.addEventListener('click', () => {
  establecerMatriz(crearMatrizVacia(leerCantidadVertices()))
})

botonEjemplo.addEventListener('click', () => {
  establecerMatriz(EJEMPLO_INFORME.map((fila) => [...fila]))
  selectOrigen.value = '0'
  selectDestino.value = '4'
  calcular()
})

botonCalcular.addEventListener('click', calcular)

for (const select of [selectOrigen, selectDestino]) {
  select.addEventListener('change', () => {
    estado.resultado = null
    limpiarTraza(contenedorTraza)
    limpiarResumen()
    refrescarGrafo()
  })
}

campoDensidad.addEventListener('input', () => {
  salidaDensidad.value = Number(campoDensidad.value).toFixed(2)
})

campoVertices.addEventListener('change', () => {
  campoVertices.value = String(leerCantidadVertices())
})

// Estado inicial: el ejemplo del informe ya resuelto, para que la pantalla
// nunca aparezca vacia y sirva de verificacion visible desde el arranque.
salidaDensidad.value = Number(campoDensidad.value).toFixed(2)
establecerMatriz(EJEMPLO_INFORME.map((fila) => [...fila]))
selectOrigen.value = '0'
selectDestino.value = '4'
calcular()
