import { EQUIVALENCIA_GENERICA, aCodigo, normalizarNombre } from "./normalizar";

/**
 * Reglas de negocio del árbol (docs/modulos/01-arbol-producto.md, reglas
 * 16–18). Funciones puras: devuelven el motivo del rechazo en castellano o
 * `null` si el cambio está permitido. Los handlers las llaman antes de tocar
 * la base; los índices únicos y el `on delete restrict` son la garantía final.
 */

export type EquivalenciaMin = {
  id: string;
  nombre: string;
  codigo: string;
  es_generica: boolean;
  activo?: boolean;
};

/**
 * Cambio sobre las equivalencias de un nodo: sin `id` es un alta; con `id` es
 * una edición de esa equivalencia.
 */
export type CambioEquivalencia = {
  id?: string;
  nombre?: string;
  codigo?: string;
  es_generica?: boolean;
  activo?: boolean;
};

export function motivoRechazoEquivalencia(
  nodoEquivalencias: EquivalenciaMin[],
  cambio: CambioEquivalencia
): string | null {
  const otras = nodoEquivalencias.filter((e) => e.id !== cambio.id);
  const actual = cambio.id ? nodoEquivalencias.find((e) => e.id === cambio.id) : undefined;

  const quiereGenerica = cambio.id ? actual?.es_generica === true : cambio.es_generica === true;

  if (quiereGenerica && !cambio.id && otras.some((e) => e.es_generica)) {
    return "Este nodo ya tiene la equivalencia genérica SIN EQUIVALENCIA.";
  }

  if (actual?.es_generica && (cambio.nombre !== undefined || cambio.codigo !== undefined)) {
    return "La equivalencia genérica SIN EQUIVALENCIA no se puede renombrar; solo activar o desactivar.";
  }

  const nombre = cambio.nombre === undefined ? undefined : normalizarNombre(cambio.nombre);
  const codigo = cambio.codigo === undefined ? undefined : aCodigo(cambio.codigo);

  if (!quiereGenerica && nombre !== undefined && nombre === EQUIVALENCIA_GENERICA.nombre) {
    return "Ese nombre está reservado para la equivalencia genérica del nodo.";
  }

  if (nombre !== undefined && otras.some((e) => normalizarNombre(e.nombre) === nombre)) {
    return `Ya existe una equivalencia llamada ${nombre} en este nodo.`;
  }

  if (codigo !== undefined && otras.some((e) => e.codigo.toUpperCase() === codigo)) {
    return `Ya existe una equivalencia con el código ${codigo} en este nodo.`;
  }

  return null;
}

export type NodoMin = {
  id: string;
  genero_id: string;
  mundo_id: string;
  linea_id: string;
  activo?: boolean;
};

export function motivoRechazoMoverNodo(
  nodo: NodoMin,
  mundoDestino: string,
  nodosExistentes: NodoMin[]
): string | null {
  if (nodo.mundo_id === mundoDestino) {
    return "El nodo ya está en ese mundo.";
  }
  const choque = nodosExistentes.find(
    (n) =>
      n.id !== nodo.id &&
      n.genero_id === nodo.genero_id &&
      n.linea_id === nodo.linea_id &&
      n.mundo_id === mundoDestino
  );
  if (choque) {
    return choque.activo === false
      ? "Esa línea ya existe en el mundo destino para este género (inactiva). Reactívala allí y desactiva este nodo."
      : "Esa línea ya existe en el mundo destino para este género. Desactiva este nodo en lugar de moverlo.";
  }
  return null;
}

export type TipoEliminable = "genero" | "mundo" | "linea" | "nodo" | "equivalencia" | "agrupacion_talla";

type Etiqueta = { sujeto: string; uno: string; varios: string; desactivar: string };

const ETIQUETAS: Record<TipoEliminable, Etiqueta> = {
  genero: { sujeto: "el género", uno: "nodo", varios: "nodos", desactivar: "Desactívalo" },
  mundo: { sujeto: "el mundo", uno: "nodo", varios: "nodos", desactivar: "Desactívalo" },
  linea: { sujeto: "la línea", uno: "nodo", varios: "nodos", desactivar: "Desactívala" },
  nodo: { sujeto: "el nodo", uno: "equivalencia", varios: "equivalencias", desactivar: "Desactívalo" },
  equivalencia: {
    sujeto: "la equivalencia",
    uno: "registro asociado",
    varios: "registros asociados",
    desactivar: "Desactívala",
  },
  agrupacion_talla: {
    sujeto: "la agrupación de talla",
    uno: "registro asociado",
    varios: "registros asociados",
    desactivar: "Desactívala",
  },
};

/** `hijos > 0` → mensaje con el conteo y la sugerencia de desactivar; `0` → null. */
export function motivoRechazoEliminar(tipo: TipoEliminable, hijos: number): string | null {
  if (hijos <= 0) return null;
  const e = ETIQUETAS[tipo];
  const cuenta = hijos === 1 ? `1 ${e.uno}` : `${hijos} ${e.varios}`;
  return `No se puede eliminar ${e.sujeto}: tiene ${cuenta}. ${e.desactivar}.`;
}
