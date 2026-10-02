/**
 * entrada.ts
 *
 * Construye la tabla editable de la matriz y los selectores de vertices.
 *
 * La simetria se mantiene por construccion: al editar la celda (i, j) se
 * escribe tambien la celda (j, i). Asi el usuario no puede producir una
 * matriz asimetrica por descuido en un grafo no dirigido.
 */

import { type MatrizEntrada, SIN_ARISTA, etiquetaVertice } from '../core/grafo.ts'

export type AlCambiarMatriz = () => void

export function dibujarMatriz(
  contenedor: HTMLElement,
  matriz: MatrizEntrada,
  alCambiar: AlCambiarMatriz
): void {
  contenedor.replaceChildren()

  const n = matriz.length
  const tabla = document.createElement('table')
  const celdas: HTMLInputElement[][] = []

  const encabezado = document.createElement('thead')
  const filaEncabezado = document.createElement('tr')
  filaEncabezado.appendChild(document.createElement('th'))

  for (let j = 0; j < n; j++) {
    const celda = document.createElement('th')
    celda.textContent = etiquetaVertice(j)
    filaEncabezado.appendChild(celda)
  }

  encabezado.appendChild(filaEncabezado)
  tabla.appendChild(encabezado)

  const cuerpo = document.createElement('tbody')

  for (let i = 0; i < n; i++) {
    const fila = document.createElement('tr')
    celdas.push([])

    const rotulo = document.createElement('th')
    rotulo.textContent = etiquetaVertice(i)
    fila.appendChild(rotulo)

    for (let j = 0; j < n; j++) {
      const contenedorCelda = document.createElement('td')
      const campo = document.createElement('input')

      campo.type = 'number'
      campo.min = '0'
      campo.value = String(matriz[i][j])
      campo.setAttribute('aria-label', 'Peso de ' + etiquetaVertice(i) + ' a ' + etiquetaVertice(j))

      if (i === j) {
        campo.disabled = true
      } else {
        campo.addEventListener('input', () => {
          const crudo = campo.value
          const valor = Number(crudo)
          const invalido = !Number.isFinite(valor) || valor < 0
          const limpio = invalido ? 0 : valor

          // solo corregimos el campo cuando el usuario escribió algo inválido;
          // si está vacío o a medio escribir, lo dejamos en paz
          if (crudo.trim() !== '' && invalido) {
            campo.value = String(limpio)
          }

          matriz[i][j] = limpio
          matriz[j][i] = limpio

          const espejo = celdas[j]?.[i]
          if (espejo && espejo.value !== String(limpio)) {
            espejo.value = String(limpio)
          }

          marcarCelda(campo, limpio)
          if (espejo) {
            marcarCelda(espejo, limpio)
          }

          alCambiar()
        })
      }

      marcarCelda(campo, matriz[i][j])
      contenedorCelda.appendChild(campo)
      fila.appendChild(contenedorCelda)
      celdas[i].push(campo)
    }

    cuerpo.appendChild(fila)
  }

  tabla.appendChild(cuerpo)
  contenedor.appendChild(tabla)
}

/** Resalta las celdas que si representan una arista. */
function marcarCelda(campo: HTMLInputElement, valor: number): void {
  campo.classList.toggle('celda--arista', valor !== SIN_ARISTA)
}

export function llenarSelectores(
  selectOrigen: HTMLSelectElement,
  selectDestino: HTMLSelectElement,
  n: number
): void {
  const origenPrevio = Number(selectOrigen.value)
  const destinoPrevio = Number(selectDestino.value)

  for (const select of [selectOrigen, selectDestino]) {
    select.replaceChildren()
    for (let i = 0; i < n; i++) {
      const opcion = document.createElement('option')
      opcion.value = String(i)
      opcion.textContent = etiquetaVertice(i)
      select.appendChild(opcion)
    }
  }

  selectOrigen.value = String(Number.isFinite(origenPrevio) && origenPrevio < n ? origenPrevio : 0)
  selectDestino.value = String(
    Number.isFinite(destinoPrevio) && destinoPrevio < n && destinoPrevio !== 0
      ? destinoPrevio
      : n - 1
  )
}

export function mostrarErrores(contenedor: HTMLElement, errores: string[]): void {
  contenedor.replaceChildren()

  if (errores.length === 0) {
    contenedor.hidden = true
    return
  }

  const lista = document.createElement('ul')
  for (const error of errores) {
    const punto = document.createElement('li')
    punto.textContent = error
    lista.appendChild(punto)
  }

  contenedor.appendChild(lista)
  contenedor.hidden = false
}
