/**
 * tema.ts
 *
 * Tema visual del sistema de despacho: oscuro (el original) o claro.
 * La eleccion se guarda en el navegador y se aplica al cargar la pagina;
 * cambiar de tema recarga la pagina, porque el estilo del mapa base y las
 * capas propias se construyen una sola vez con los colores del tema.
 */

export type Tema = 'oscuro' | 'claro'

const CLAVE = 'samu-tema'

function leerTema(): Tema {
  try {
    return localStorage.getItem(CLAVE) === 'claro' ? 'claro' : 'oscuro'
  } catch {
    return 'oscuro'
  }
}

export const TEMA: Tema = leerTema()
document.documentElement.dataset.tema = TEMA

export function cambiarTema(): void {
  try {
    localStorage.setItem(CLAVE, TEMA === 'claro' ? 'oscuro' : 'claro')
  } catch {
    return
  }
  location.reload()
}

/** Colores de la onda de Dijkstra, en RGB de 0 a 1, para el sombreador. */
export interface ColoresOnda {
  cerca: [number, number, number]
  lejos: [number, number, number]
  frente: [number, number, number]
}

export interface Paleta {
  estiloMapa: string
  /** Ocupacion: saturado, alta, media, normal. */
  ocupacion: [string, string, string, string]
  cercano: string
  propuesta: string
  propuestaInicio: string
  haloOpacidad: number
  hospitalHalo: string
  bordeElegido: string
  bordeAlcanzado: string
  bordeNormal: string
  etiqueta: string
  etiquetaHalo: string
  unidadPropuesta: string
  unidadCercano: string
  textoTenue: string
  onda: ColoresOnda
}

const OSCURA: Paleta = {
  estiloMapa: 'https://tiles.openfreemap.org/styles/dark',
  ocupacion: ['#ff3b5c', '#ff8a3d', '#ffd23d', '#3dffa8'],
  cercano: '#ff8a3d',
  propuesta: '#3dffa8',
  propuestaInicio: '#7cf3ff',
  haloOpacidad: 0.45,
  hospitalHalo: '#ffffff',
  bordeElegido: '#ffffff',
  bordeAlcanzado: '#e6f7ff',
  bordeNormal: '#0b1020',
  etiqueta: '#d7e3ff',
  etiquetaHalo: '#0b1020',
  unidadPropuesta: '#e9fff5',
  unidadCercano: '#ffd2b3',
  textoTenue: '#8d9bc2',
  onda: { cerca: [0.2, 0.85, 1.0], lejos: [0.55, 0.35, 1.0], frente: [1.0, 0.98, 0.9] }
}

// Clara y sobria: tinta azul pizarra, verde azulado clinico para la propuesta,
// ambar para el criterio actual y rojo solo para la saturacion.
const CLARA: Paleta = {
  estiloMapa: 'https://tiles.openfreemap.org/styles/positron',
  ocupacion: ['#b42318', '#c2410c', '#b7791f', '#0f766e'],
  cercano: '#c2410c',
  propuesta: '#0f766e',
  propuestaInicio: '#14b8a6',
  haloOpacidad: 0.22,
  hospitalHalo: '#17212b',
  bordeElegido: '#17212b',
  bordeAlcanzado: '#0f766e',
  bordeNormal: '#ffffff',
  etiqueta: '#17212b',
  etiquetaHalo: '#ffffff',
  unidadPropuesta: '#ffffff',
  unidadCercano: '#ffffff',
  textoTenue: '#5b6875',
  onda: { cerca: [0.06, 0.46, 0.43], lejos: [0.15, 0.27, 0.55], frente: [0.05, 0.2, 0.25] }
}

export const PALETA: Paleta = TEMA === 'claro' ? CLARA : OSCURA
