/**
 * trazaVista.ts
 *
 * Renderiza el desarrollo paso a paso del algoritmo con el mismo formato
 * de tabla con el que Dijkstra se resuelve a mano: una fila por iteracion,
 * una columna por vertice y el detalle de las relajaciones debajo.
 */

import { etiquetaVertice } from '../core/grafo.ts'
import { type ResultadoDijkstra } from '../core/dijkstra.ts'

function texto(valor: number): string {
  return Number.isFinite(valor) ? String(valor) : '∞'
}

function celdaDistancia(valor: number, esDefinitivo: boolean): HTMLTableCellElement {
  const celda = document.createElement('td')
  celda.textContent = texto(valor)

  if (!Number.isFinite(valor)) {
    celda.className = 'celda--infinito'
  } else if (esDefinitivo) {
    celda.className = 'celda--definitiva'
  }

  return celda
}

export function dibujarTraza(contenedor: HTMLElement, resultado: ResultadoDijkstra): void {
  contenedor.replaceChildren()

  const n = resultado.distancias.length
  const tabla = document.createElement('table')

  const encabezado = document.createElement('thead')
  const filaEncabezado = document.createElement('tr')

  for (const titulo of ['Iteración', 'Vértice definitivo']) {
    const celda = document.createElement('th')
    celda.textContent = titulo
    filaEncabezado.appendChild(celda)
  }

  for (let i = 0; i < n; i++) {
    const celda = document.createElement('th')
    celda.textContent = 'd(' + etiquetaVertice(i) + ')'
    filaEncabezado.appendChild(celda)
  }

  encabezado.appendChild(filaEncabezado)
  tabla.appendChild(encabezado)

  const cuerpo = document.createElement('tbody')

  const filaInicio = document.createElement('tr')
  filaInicio.className = 'fila--inicio'

  const celdaInicio = document.createElement('td')
  celdaInicio.textContent = 'Inicio'
  filaInicio.appendChild(celdaInicio)

  const celdaGuion = document.createElement('td')
  celdaGuion.textContent = '—'
  filaInicio.appendChild(celdaGuion)

  for (const valor of resultado.estadoInicial) {
    filaInicio.appendChild(celdaDistancia(valor, false))
  }

  cuerpo.appendChild(filaInicio)

  for (const paso of resultado.traza) {
    const fila = document.createElement('tr')

    const celdaIteracion = document.createElement('td')
    celdaIteracion.textContent = String(paso.iteracion)
    fila.appendChild(celdaIteracion)

    const celdaVertice = document.createElement('td')
    celdaVertice.textContent =
      etiquetaVertice(paso.verticeDefinitivo) + ' (' + texto(paso.distanciaDefinitiva) + ')'
    fila.appendChild(celdaVertice)

    for (let i = 0; i < n; i++) {
      fila.appendChild(celdaDistancia(paso.distancias[i], i === paso.verticeDefinitivo))
    }

    cuerpo.appendChild(fila)
  }

  tabla.appendChild(cuerpo)
  contenedor.appendChild(tabla)

  const notas = document.createElement('ul')
  notas.className = 'traza__notas'

  for (const paso of resultado.traza) {
    for (const act of paso.actualizaciones) {
      const linea = document.createElement('li')
      linea.textContent =
        'Iteración ' +
        paso.iteracion +
        ': ' +
        etiquetaVertice(act.vertice) +
        ' pasa de ' +
        texto(act.distanciaAnterior) +
        ' a ' +
        texto(act.distanciaNueva) +
        ' a través de ' +
        etiquetaVertice(act.via) +
        '.'
      notas.appendChild(linea)
    }
  }

  if (resultado.terminoAnticipadamente) {
    const cierre = document.createElement('li')
    cierre.textContent =
      'El algoritmo se detiene al declarar definitivo el destino, porque su etiqueta ya no puede mejorar.'
    notas.appendChild(cierre)
  }

  if (notas.childElementCount > 0) {
    contenedor.appendChild(notas)
  }
}

export function limpiarTraza(contenedor: HTMLElement): void {
  contenedor.replaceChildren()
  const aviso = document.createElement('p')
  aviso.className = 'traza__vacia'
  aviso.textContent = 'Aquí aparece el estado de las etiquetas en cada iteración.'
  contenedor.appendChild(aviso)
}
