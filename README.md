# camino-minimo

Resuelve el problema del camino mínimo en un grafo ponderado no dirigido
mediante el algoritmo de Dijkstra. Proyecto del curso Matemática
Computacional (MA475), UPC.

El programa admite entre 5 y 15 vértices, construye la matriz de adyacencia
de forma manual o automática, dibuja el grafo, resalta la ruta óptima y
muestra el desarrollo paso a paso del algoritmo.

## Requisitos

Node 22.6 o superior (los scripts de prueba usan `--experimental-strip-types`).

## Ejecución

    npm install
    npm run dev

## Pruebas

    npm run verificar      # caso del informe y contraste contra fuerza bruta
    npm run verificar:ui   # prueba de humo de la interfaz en jsdom
    npm run typecheck      # verificación de tipos

## Estructura

    src/core/    núcleo de cálculo, sin referencias al navegador
    src/ui/      capa de presentación
    pruebas/     verificación automatizada