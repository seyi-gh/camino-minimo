/**
 * verificar.ts
 *
 * Dos verificaciones independientes del nucleo:
 *
 *   1. Reproduce el caso de cinco vertices resuelto a mano en el informe.
 *   2. Compara Dijkstra contra una busqueda exhaustiva de todos los caminos
 *      simples sobre grafos aleatorios. La fuerza bruta es lenta pero
 *      obviamente correcta, asi que sirve de referencia.
 */

import { construirPesos, etiquetaVertice, validarMatriz, type MatrizPesos } from '../src/core/grafo.ts'
import { costoDeCamino, dijkstra } from '../src/core/dijkstra.ts'
import { generarMatriz } from '../src/core/aleatorio.ts'

const CASO_INFORME = [
  [0, 4, 2, 0, 14],
  [4, 0, 1, 5, 20],
  [2, 1, 0, 8, 10],
  [0, 5, 8, 0, 2],
  [14, 20, 10, 2, 0]
]

function mostrar(valor: number): string {
  return Number.isFinite(valor) ? String(valor) : 'inf'
}

function verificarCasoDelInforme(): boolean {
  console.log('=== Caso de cinco vertices del informe ===\n')

  const validacion = validarMatriz(CASO_INFORME)
  if (!validacion.valida) {
    console.log('La matriz no paso la validacion:')
    validacion.errores.forEach((e) => console.log('  - ' + e))
    return false
  }

  const pesos = construirPesos(CASO_INFORME)
  const resultado = dijkstra(pesos, 0, 4)

  const encabezado = ['Iter', 'Definitivo']
  for (let i = 0; i < 5; i++) {
    encabezado.push('d(' + etiquetaVertice(i) + ')')
  }
  console.log(encabezado.join('\t'))

  console.log(['Inicio', '-', ...resultado.estadoInicial.map(mostrar)].join('\t'))

  for (const paso of resultado.traza) {
    const fila = [
      String(paso.iteracion),
      etiquetaVertice(paso.verticeDefinitivo) + ' (' + mostrar(paso.distanciaDefinitiva) + ')',
      ...paso.distancias.map(mostrar)
    ]
    console.log(fila.join('\t'))

    for (const act of paso.actualizaciones) {
      console.log(
        '        ' +
          etiquetaVertice(act.vertice) +
          ': ' +
          mostrar(act.distanciaAnterior) +
          ' -> ' +
          mostrar(act.distanciaNueva) +
          ' via ' +
          etiquetaVertice(act.via)
      )
    }
  }

  const caminoTexto = resultado.camino.map(etiquetaVertice).join(', ')
  console.log('\nCamino minimo: ' + caminoTexto)
  console.log('Costo total:   ' + mostrar(resultado.costoTotal))
  console.log('Recalculado:   ' + mostrar(costoDeCamino(pesos, resultado.camino)))

  const caminoEsperado = 'v1, v3, v2, v4, v5'
  const costoEsperado = 10
  const ok = caminoTexto === caminoEsperado && resultado.costoTotal === costoEsperado

  console.log(
    '\nEsperado: ' +
      caminoEsperado +
      ' con costo ' +
      costoEsperado +
      '  ->  ' +
      (ok ? 'COINCIDE' : 'NO COINCIDE')
  )

  return ok
}

/** Busca el camino de menor costo probando todas las rutas simples. */
function fuerzaBruta(pesos: MatrizPesos, origen: number, destino: number): number {
  const n = pesos.length
  const visitado: boolean[] = new Array(n).fill(false)
  let mejor = Infinity

  function explorar(actual: number, acumulado: number): void {
    if (acumulado >= mejor) {
      return
    }
    if (actual === destino) {
      mejor = acumulado
      return
    }

    visitado[actual] = true
    for (let v = 0; v < n; v++) {
      if (!visitado[v] && Number.isFinite(pesos[actual][v]) && v !== actual) {
        explorar(v, acumulado + pesos[actual][v])
      }
    }
    visitado[actual] = false
  }

  explorar(origen, 0)
  return mejor
}

function verificarContraFuerzaBruta(repeticiones: number): boolean {
  console.log('\n=== Dijkstra contra busqueda exhaustiva ===\n')

  let fallos = 0

  for (let k = 0; k < repeticiones; k++) {
    const n = 5 + (k % 4)
    const { matriz, semilla } = generarMatriz(n, {
      semilla: 1000 + k,
      densidad: 0.35,
      pesoMaximo: 30
    })

    const pesos = construirPesos(matriz)

    for (let origen = 0; origen < n; origen++) {
      for (let destino = 0; destino < n; destino++) {
        if (origen === destino) {
          continue
        }

        const resultado = dijkstra(pesos, origen, destino)
        const referencia = fuerzaBruta(pesos, origen, destino)

        if (resultado.costoTotal !== referencia) {
          fallos++
          console.log(
            'DISCREPANCIA con semilla ' +
              semilla +
              ', n=' +
              n +
              ', ' +
              etiquetaVertice(origen) +
              ' -> ' +
              etiquetaVertice(destino) +
              ': dijkstra=' +
              mostrar(resultado.costoTotal) +
              ' fuerzaBruta=' +
              mostrar(referencia)
          )
        }

        // El camino devuelto debe costar exactamente lo que se reporta.
        if (resultado.alcanzable) {
          const recalculado = costoDeCamino(pesos, resultado.camino)
          if (recalculado !== resultado.costoTotal) {
            fallos++
            console.log(
              'El camino no cuadra con el costo reportado en semilla ' + semilla
            )
          }
        }
      }
    }
  }

  console.log(
    repeticiones +
      ' grafos probados con todos sus pares origen-destino  ->  ' +
      (fallos === 0 ? 'SIN DISCREPANCIAS' : fallos + ' FALLOS')
  )

  return fallos === 0
}

const a = verificarCasoDelInforme()
const b = verificarContraFuerzaBruta(40)

if (a && b) {
  console.log('\nTodas las verificaciones pasaron.')
} else {
  // Lanzar termina con codigo distinto de cero sin depender de los tipos de Node.
  throw new Error('Hay verificaciones fallidas.')
}
