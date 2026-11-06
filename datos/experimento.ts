/**
 * experimento.ts
 *
 * Experimento de resultados del ensayo: simula dias completos de operacion
 * del SAMU en Lima con la red vial real y compara el despacho actual (al
 * hospital elegible mas cercano) con el despacho por sumidero virtual.
 *
 * Cada escenario se repite con varias semillas; las dos politicas reciben
 * exactamente las mismas emergencias en cada repeticion. Las tablas de
 * tiempo se recalculan cada hora con el trafico de esa hora.
 *
 *   node datos/experimento.ts > datos/resultados.json
 */

import { readFileSync } from 'node:fs'
import { ESCENARIO_BASE, pesosDeRed } from '../src/core/costos.ts'
import { type Hospital, tiemposDesde } from '../src/core/despacho.ts'
import { invertir, leerRed } from '../src/core/red.ts'
import { type Distrito, type Metricas, Simulacion } from '../src/core/simulacion.ts'

const bytes = readFileSync('public/datos/red.bin')
const red = leerRed(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
const inversa = invertir(red)
const hospitales: Hospital[] = JSON.parse(readFileSync('public/datos/hospitales.json', 'utf8')).hospitales
const distritos: Distrito[] = JSON.parse(readFileSync('public/datos/distritos.json', 'utf8')).distritos

// Tablas por hora, calculadas una sola vez y compartidas por todos los escenarios.
const tablasPorHora: Float32Array[][] = []
for (let hora = 0; hora < 24; hora++) {
  const pesos = pesosDeRed(inversa, { ...ESCENARIO_BASE, hora })
  tablasPorHora.push(hospitales.map((h) => tiemposDesde(inversa, pesos, h.vertice)))
  process.stderr.write(`tablas ${hora + 1}/24\r`)
}
process.stderr.write('\n')

const ESCENARIOS = [
  { nombre: 'Demanda habitual', incidentesPorHora: 8 },
  { nombre: 'Demanda alta', incidentesPorHora: 18 },
  {
    nombre: 'Brote respiratorio',
    incidentesPorHora: 32,
    distribucion: { trauma: 0.2, cardiaca: 0.1, respiratoria: 0.45, obstetrica: 0.08, pediatrica: 0.09, general: 0.08 }
  }
]
const SEMILLAS = [11, 23, 37, 41, 59]

interface Fila {
  escenario: string
  semilla: number
  cercano: Metricas
  samu: Metricas
  cambiosDeHospital: number
}

const filas: Fila[] = []
for (const e of ESCENARIOS) {
  for (const semilla of SEMILLAS) {
    const sim = new Simulacion({
      hospitales,
      distritos,
      tablas: tablasPorHora[0],
      semilla,
      horaInicio: 0,
      incidentesPorHora: e.incidentesPorHora,
      distribucion: e.distribucion
    })
    let cambios = 0
    for (let minuto = 0; minuto < 24 * 60; minuto++) {
      sim.actualizarTablas(tablasPorHora[Math.floor(sim.hora) % 24])
      for (const ev of sim.avanzar(60)) {
        if (ev.samu.hospital !== ev.cercano.hospital) cambios++
      }
    }
    filas.push({
      escenario: e.nombre,
      semilla,
      cercano: sim.metricas('cercano'),
      samu: sim.metricas('samu'),
      cambiosDeHospital: cambios
    })
    process.stderr.write(`${e.nombre} semilla ${semilla} listo\n`)
  }
}

// Resumen por escenario: promedio sobre semillas, en minutos.
const min = (s: number) => Math.round((s / 60) * 10) / 10
const resumen = ESCENARIOS.map((e) => {
  const fs = filas.filter((f) => f.escenario === e.nombre)
  const prom = (sel: (f: Fila) => number) => fs.reduce((a, f) => a + sel(f), 0) / fs.length
  const ahorros = fs.map((f) => (f.cercano.totalMedio - f.samu.totalMedio) / 60)
  return {
    escenario: e.nombre,
    incidentesPorHora: e.incidentesPorHora,
    atendidosPorDia: Math.round(prom((f) => f.samu.atendidos)),
    cercano: {
      viaje: min(prom((f) => f.cercano.viajeMedio)),
      espera: min(prom((f) => f.cercano.esperaMedia)),
      total: min(prom((f) => f.cercano.totalMedio)),
      p90: min(prom((f) => f.cercano.p90Total)),
      saturacionHoras: Math.round(prom((f) => f.cercano.minutosSaturados) / 6) / 10
    },
    samu: {
      viaje: min(prom((f) => f.samu.viajeMedio)),
      espera: min(prom((f) => f.samu.esperaMedia)),
      total: min(prom((f) => f.samu.totalMedio)),
      p90: min(prom((f) => f.samu.p90Total)),
      saturacionHoras: Math.round(prom((f) => f.samu.minutosSaturados) / 6) / 10
    },
    ahorroMedioMin: Math.round(prom((f) => (f.cercano.totalMedio - f.samu.totalMedio) / 60) * 10) / 10,
    ahorroMinimoMin: Math.round(Math.min(...ahorros) * 10) / 10,
    ahorroMaximoMin: Math.round(Math.max(...ahorros) * 10) / 10,
    despachosDesviados: Math.round(prom((f) => f.cambiosDeHospital / f.samu.atendidos) * 1000) / 10
  }
})

console.log(JSON.stringify({ semillas: SEMILLAS, resumen, detalle: filas }, null, 1))
