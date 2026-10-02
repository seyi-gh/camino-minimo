/**
 * grafoVista.ts
 *
 * Dibuja el grafo ponderado en SVG con una disposicion circular.
 *
 * La disposicion circular se elige porque con 15 vertices como maximo
 * garantiza que ningun nodo tape a otro y que todas las aristas sean
 * visibles, a diferencia de una disposicion por fuerzas que puede
 * producir resultados distintos en cada ejecucion.
 */

import { type MatrizEntrada, SIN_ARISTA, etiquetaVertice } from '../core/grafo.ts'

const NS = 'http://www.w3.org/2000/svg'

const LIENZO = 640
const CENTRO = LIENZO / 2
const RADIO_DISPOSICION = 238
const RADIO_NODO = 18
const DESPLAZAMIENTO_PESO = 11

export interface OpcionesDibujo {
  camino?: number[]
  origen?: number
  destino?: number
}

interface Punto {
  x: number
  y: number
}

function crear<K extends keyof SVGElementTagNameMap>(
  etiqueta: K,
  atributos: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const elemento = document.createElementNS(NS, etiqueta)
  for (const [clave, valor] of Object.entries(atributos)) {
    elemento.setAttribute(clave, String(valor))
  }
  return elemento
}

/** Posiciones de los n vertices repartidos sobre una circunferencia. */
export function calcularPosiciones(n: number): Punto[] {
  const puntos: Punto[] = []
  for (let i = 0; i < n; i++) {
    // Se resta un cuarto de vuelta para que el vertice 1 quede arriba.
    const angulo = (2 * Math.PI * i) / n - Math.PI / 2
    puntos.push({
      x: CENTRO + RADIO_DISPOSICION * Math.cos(angulo),
      y: CENTRO + RADIO_DISPOSICION * Math.sin(angulo)
    })
  }
  return puntos
}

/** Conjunto de aristas del camino, en ambos sentidos para busqueda rapida. */
function aristasDelCamino(camino: number[]): Set<string> {
  const conjunto = new Set<string>()
  for (let i = 0; i < camino.length - 1; i++) {
    conjunto.add(camino[i] + '-' + camino[i + 1])
    conjunto.add(camino[i + 1] + '-' + camino[i])
  }
  return conjunto
}

export function dibujarGrafo(
  svg: SVGSVGElement,
  matriz: MatrizEntrada,
  opciones: OpcionesDibujo = {}
): void {
  svg.replaceChildren()

  const n = matriz.length

  if (n === 0) {
    const aviso = crear('text', { x: CENTRO, y: CENTRO, class: 'lienzo__vacio' })
    aviso.textContent = 'Genera un grafo o ingresa la matriz para verlo aquí.'
    svg.appendChild(aviso)
    return
  }

  const posiciones = calcularPosiciones(n)
  const camino = opciones.camino ?? []
  const enRuta = aristasDelCamino(camino)
  const enCamino = new Set(camino)

  const capaAristas = crear('g')
  const capaRuta = crear('g')
  const capaPesos = crear('g')
  const capaNodos = crear('g')

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (matriz[i][j] === SIN_ARISTA) {
        continue
      }

      const a = posiciones[i]
      const b = posiciones[j]
      const esRuta = enRuta.has(i + '-' + j)

      const linea = crear('line', {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        class: esRuta ? 'arista arista--ruta' : 'arista'
      })

      if (esRuta) {
        capaRuta.appendChild(linea)
      } else {
        capaAristas.appendChild(linea)
      }

      dibujarPeso(capaPesos, a, b, matriz[i][j], esRuta)
    }
  }

  for (let i = 0; i < n; i++) {
    const punto = posiciones[i]
    const esExtremo = i === opciones.origen || i === opciones.destino
    const esIntermedio = !esExtremo && enCamino.has(i)

    let clase = 'nodo'
    if (esExtremo) {
      clase += ' nodo--extremo'
    } else if (esIntermedio) {
      clase += ' nodo--ruta'
    }

    capaNodos.appendChild(
      crear('circle', { cx: punto.x, cy: punto.y, r: RADIO_NODO, class: clase })
    )

    const texto = crear('text', {
      x: punto.x,
      y: punto.y + 0.5,
      class: esExtremo ? 'nodo__texto nodo__texto--extremo' : 'nodo__texto'
    })
    texto.textContent = etiquetaVertice(i)
    capaNodos.appendChild(texto)
  }

  svg.append(capaAristas, capaRuta, capaPesos, capaNodos)
}

/**
 * Escribe el peso de una arista en su punto medio, corrido en direccion
 * perpendicular para que dos aristas cruzadas no superpongan sus etiquetas,
 * y con un fondo claro detras para que el texto se lea sobre las lineas.
 */
function dibujarPeso(
  capa: SVGGElement,
  a: Punto,
  b: Punto,
  peso: number,
  esRuta: boolean
): void {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const largo = Math.hypot(dx, dy) || 1

  const x = (a.x + b.x) / 2 + (-dy / largo) * DESPLAZAMIENTO_PESO
  const y = (a.y + b.y) / 2 + (dx / largo) * DESPLAZAMIENTO_PESO

  const texto = String(peso)
  const ancho = texto.length * 7 + 8

  capa.appendChild(
    crear('rect', {
      x: x - ancho / 2,
      y: y - 8,
      width: ancho,
      height: 16,
      rx: 2,
      class: 'peso__halo'
    })
  )

  const etiqueta = crear('text', {
    x,
    y,
    class: esRuta ? 'peso peso--ruta' : 'peso'
  })
  etiqueta.textContent = texto
  capa.appendChild(etiqueta)
}
