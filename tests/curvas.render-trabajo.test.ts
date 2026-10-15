import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AlertaAccion } from "../src/app/(app)/planificacion/curvas-estacionalidad/alerta-accion";
import { AniosNinoTab } from "../src/app/(app)/planificacion/curvas-estacionalidad/anios-nino-tab";
import { AntesDeCalcular } from "../src/app/(app)/planificacion/curvas-estacionalidad/antes-de-calcular";
import { AprobarPanel } from "../src/app/(app)/planificacion/curvas-estacionalidad/aprobar-panel";
import { CurvasTab } from "../src/app/(app)/planificacion/curvas-estacionalidad/curvas-tab";
import { DetalleAgrupacion } from "../src/app/(app)/planificacion/curvas-estacionalidad/detalle-agrupacion";
import { ParametrosAgrupacion } from "../src/app/(app)/planificacion/curvas-estacionalidad/parametros-agrupacion";
import { NavegarAgrupaciones } from "../src/app/(app)/planificacion/curvas-estacionalidad/navegar-agrupaciones";
import { RedPanel } from "../src/app/(app)/planificacion/curvas-estacionalidad/red-panel";
import { parametrosPorDefecto } from "../src/app/(app)/planificacion/curvas-estacionalidad/trabajo-vista";
import { FotoModal, VersionesPanel } from "../src/app/(app)/planificacion/curvas-estacionalidad/versiones-panel";
import { compararCurvas } from "../src/app/(app)/planificacion/curvas-estacionalidad/vista";
import type { AgrupacionResultado, EstadoCurvasApi, Prerrequisito, RedAnioApi, TrabajoAgrupacionApi, VersionesAgrupacionApi } from "../src/lib/curvas/tipos-api";
import { agrupacion, anio, curvaConPico, PLANA, vigente } from "./curvas.pantalla.fixture";

/**
 * Humo de render de la vista de trabajo por agrupación y de la lista v2 (06b), con datos sintéticos
 * (nada real de Lukers): ningún componente lanza, los textos clave salen y las reglas de UX se ven en el HTML.
 */

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const HUELLA = "0123456789abcdef0123456789abcdef";
const T1 = "0b8b6f0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
const T2 = "1b8b6f0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";

const parcial = Array.from({ length: 12 }, (_, i) => (i < 9 ? 1 / 9 : 0));
const anios = [
  anio(2023, { clase: "atipico_completo", tratamiento: "incluido", meses_atipicos: 12 }),
  anio(2024),
  anio(2025),
  anio(2026, {
    clase: "en_curso",
    meses_cargados: 9,
    participacion: null,
    participacion_parcial: parcial,
    en_ajuste: false,
    por_tienda: [
      { tienda_id: T1, unidades: 78, peso: 0.78, participacion: PLANA, eat_vs_red: 1, distinta: false },
      { tienda_id: T2, unidades: 22, peso: 0.22, participacion: PLANA, eat_vs_red: 20, distinta: true },
    ],
  }),
];

const resultado = {
  agrupacion_id: "a1",
  temporada: "invierno",
  temporada_sugerida: null,
  origen: "propia",
  composicion: { equivalencias: 10, huella: "x" },
  efecto_atipico: { volumen: [], forma: null },
  anios,
  candidatas: [
    { modelo: "A", curva: PLANA, motivo: null, eat: 29.1, error_max: 7, pruebas: 3, pliegues: 3, eat_por_pliegue: [], eat_parcial: null, igual_a: null, prestada: false },
    { modelo: "B", curva: curvaConPico(6, 0.2), motivo: null, eat: 27.4, error_max: 7, pruebas: 3, pliegues: 3, eat_por_pliegue: [], eat_parcial: null, igual_a: null, prestada: false },
  ],
  recomendada: "A",
  motivo_recomendacion: "sin_evidencia",
  margen: 8.3,
  comparacion: { mejor: "B", eat_mejor: 27.4, eat_a: 29.1, margen: 8.3, pliegues: 3, ruido_normal: 33, margen_ruido: 0.25, frase: "B se equivoca 27.4 pp frente a 29.1 de A en 3 pruebas." },
  ruido_normal: 33,
  ruido_normal_detalle: [{ anios: [2024, 2025], eat: 33 }],
  estabilidad: 0.7,
  nivel_estabilidad: "media",
  banda: null,
  cv_mensual: [],
  avisos: [],
} as unknown as AgrupacionResultado;

const tienda = (id: string, codigo: string, extra: Record<string, unknown> = {}) => ({
  tienda_id: id,
  codigo,
  nombre: `TIENDA ${codigo}`,
  entra: true,
  motivos: [],
  meses_sin_venta: [],
  primer_mes_con_venta: null,
  entra_desde: null,
  unidades: 100,
  peso: 0.5,
  participacion: PLANA,
  eat_vs_red: 2,
  distinta: false,
  ...extra,
});
const red = [
  { anio: 2025, tiendas: [tienda(T1, "T01"), tienda(T2, "T10", { entra: false, peso: 0, participacion: null, motivos: ["tienda_nueva"], entra_desde: 2026 })], total_unidades: 1, dominante: null, peso_mayor: 0.5, sin_red: false, participacion: PLANA, ruido_normal: null },
  { anio: 2026, tiendas: [tienda(T1, "T01"), tienda(T2, "T10", { peso: 0.22 })], total_unidades: 1, dominante: null, peso_mayor: 0.5, sin_red: false, participacion: PLANA, ruido_normal: null },
] as unknown as RedAnioApi[];

function trabajo(extra: Partial<TrabajoAgrupacionApi> = {}): TrabajoAgrupacionApi {
  return {
    agrupacion: { id: "a1", nombre: "ABRIGO SINTÉTICO", codigo: "ABRIGO", activo: true, temporada: "invierno", temporada_sugerida: null, generos: ["HOMBRE"], equivalencias_activas: 140 },
    datos: { desde: "2023-01", hasta: "2026-09", meses_publicados: 45, faltantes: [], hasta_periodo: "2026-09", hasta_fue_por_defecto: true, ultimo_mes_cerrado: "2026-09", meses_posteriores: [], cargas_huella: HUELLA },
    parametros: parametrosPorDefecto(),
    prerrequisitos: { bloquea: [], avisa: [] },
    huella_calculo: HUELLA,
    huella_temporada: HUELLA,
    version_modelo: 1,
    calculo: {
      resultado,
      temporada_curva: null,
      efecto_temporada: [],
      red,
      tiendas: [
        { id: T1, codigo: "T01", nombre: "TIENDA T01" },
        { id: T2, codigo: "T10", nombre: "TIENDA T10" },
      ],
      duracion_ms: 1800,
    },
    vigente: null,
    obsoleta: null,
    avisos_vigente: [],
    comparador: null,
    versiones: 0,
    ...extra,
  };
}

const bloqueo = (codigo: Prerrequisito["codigo"], detalle: string, enlace: Prerrequisito["enlace"]): Prerrequisito => ({ codigo, nivel: "bloquea", detalle, enlace });

describe("tarjeta «Antes de calcular»", () => {
  const props = { confirmadoSinPeriodos: false, onConfirmarSinPeriodos: () => {}, onIrAPeriodos: () => {}, deshabilitado: false };

  it("si bloquea: «No se puede calcular todavía», con el motivo, el enlace para arreglarlo y la casilla de excepción; sin gráfico", () => {
    const h = html(
      createElement(AntesDeCalcular, {
        ...props,
        datos: trabajo({
          calculo: null,
          prerrequisitos: {
            bloquea: [
              bloqueo("periodos_temporada_faltantes", "No hay periodos atípicos para invierno.", { pantalla: "periodos" }),
              bloqueo("tienda_sin_apertura", "La tienda T04 tiene venta y no tiene fecha de apertura.", { pantalla: "tiendas", id: T1 }),
            ],
            avisa: [],
          },
        }),
      })
    );
    expect(h).toContain("No se puede calcular todavía");
    expect(h).toContain("No hay periodos atípicos para invierno.");
    expect(h).toContain("→ Periodos atípicos");
    expect(h).toContain('href="/maestros/tiendas"');
    expect(h).toContain("Confirmo que esta temporada no tiene años atípicos");
    expect(h).toContain('type="checkbox"');
    expect(h).not.toContain("Curvas de la agrupación");
  });

  it("si solo avisa: «Antes de calcular» con lo comprobado y los avisos visibles, sin casilla", () => {
    const h = html(
      createElement(AntesDeCalcular, {
        ...props,
        datos: trabajo({ prerrequisitos: { bloquea: [], avisa: [{ codigo: "temporada_sin_confirmar", nivel: "avisa", detalle: "Sigue en Toda temporada: confirma la temporada antes de aprobar", enlace: null }] } }),
      })
    );
    expect(h).toContain("Antes de calcular");
    expect(h).toContain("Temporada invierno");
    expect(h).toContain("Años del Niño reconocidos: 2023 (atípico completo)");
    expect(h).toContain("45 meses publicados sin huecos");
    expect(h).toContain("Sigue en Toda temporada");
    expect(h).not.toContain('type="checkbox"');
    expect(h).not.toContain("No se puede calcular todavía");
  });

  it("con la excepción confirmada y otro bloqueo, la casilla sigue a la vista (marcada) y desmarcable", () => {
    const h = html(
      createElement(AntesDeCalcular, {
        ...props,
        confirmadoSinPeriodos: true,
        datos: trabajo({
          calculo: null,
          prerrequisitos: {
            bloquea: [bloqueo("tienda_sin_apertura", "La tienda T04 tiene venta y no tiene fecha de apertura.", { pantalla: "tiendas", id: T1 })],
            avisa: [{ codigo: "periodos_temporada_faltantes", nivel: "avisa", detalle: "Sin periodos confirmado.", enlace: { pantalla: "periodos" } }],
          },
        }),
      })
    );
    expect(h).toContain("No se puede calcular todavía");
    expect(h).toContain("Confirmo que esta temporada no tiene años atípicos");
    expect(h).toContain("checked");
    expect(h).not.toContain('disabled=""');
    expect(h.match(/type="checkbox"/g)).toHaveLength(1);
  });

  it("con la excepción confirmada, la casilla sigue a la vista (marcada) para poder quitarla", () => {
    const h = html(
      createElement(AntesDeCalcular, {
        ...props,
        confirmadoSinPeriodos: true,
        datos: trabajo({ prerrequisitos: { bloquea: [], avisa: [{ codigo: "periodos_temporada_faltantes", nivel: "avisa", detalle: "Sin periodos: se confirmó que no hubo años atípicos.", enlace: { pantalla: "periodos" } }] } }),
      })
    );
    expect(h).toContain("checked");
    expect(h).toContain("Confirmo que esta temporada no tiene años atípicos");
  });
});

describe("panel «Parámetros de esta agrupación»", () => {
  const base = { hasta: "", deshabilitado: false, onCambiar: () => {}, onCambiarHasta: () => {}, onRestablecer: () => {} };

  it("con los valores por defecto arranca plegado, con «Restablecer» deshabilitado", () => {
    const h = html(createElement(ParametrosAgrupacion, { ...base, datos: trabajo(), parametros: parametrosPorDefecto() }));
    expect(h).toContain("Parámetros de esta agrupación");
    expect(h).toContain("Valores por defecto");
    expect(h).toContain("Todo en su valor por defecto");
    expect(h).toContain("Restablecer");
    expect(h).not.toContain("Excluir del ajuste");
  });

  it("con parámetros distintos arranca desplegado: años con casilla, tratamiento, tiendas con casilla, «Calcular hasta» y umbrales sin edición", () => {
    const parametros = { ...parametrosPorDefecto(), anios_excluidos: [2023], tiendas_excluidas: [T2], tratamiento_atipicos: "descartar" as const };
    const h = html(createElement(ParametrosAgrupacion, { ...base, datos: trabajo({ parametros }), parametros }));
    expect(h).toContain("3 parámetros distintos del valor por defecto");
    expect(h).toContain("Excluido del ajuste a mano");
    expect(h).toContain("2026 parcial");
    expect(h).toContain("solo valida");
    for (const o of ["Automático", "Incluir tal cual", "Imputar con la referencia", "Descartar"]) expect(h).toContain(o);
    expect(h).toContain("T10 · TIENDA T10");
    expect(h).toContain("Excluida a mano");
    expect(h).toContain("2025: fuera (tienda nueva: entra en 2026)");
    expect(h).toContain("2026: entra, 22.0 % (distinta, 20.0 pp)");
    expect(h).toContain("Calcular hasta");
    expect(h).toContain("Último mes publicado y cerrado (por defecto)");
    expect(h).toContain("2026-09");
    expect(h).toContain("no se hereda");
    expect(h).toContain("Umbrales");
    expect(h).toContain("segunda entrega");
    expect(h).toContain("pide escribir el motivo");
    // los umbrales no se editan: ningún campo numérico
    expect(h).not.toContain('type="number"');
    expect(h).not.toContain('inputmode="decimal"');
  });

  it("dice con qué mes se aprobó la vigente cuando difiere (la cabecera del «Calcular hasta»)", () => {
    const parametros = { ...parametrosPorDefecto(), tratamiento_atipicos: "imputar" as const };
    const h = html(createElement(ParametrosAgrupacion, { ...base, datos: trabajo({ parametros, vigente: vigente({ hasta_periodo: "2026-08" }) }), parametros }));
    expect(h).toContain("la vigente usó 2026-08");
  });
});

describe("«Aprobada frente a propuesta» y Aprobar", () => {
  const prop = { etiqueta: "Propuesta A · Promedio simple", curva: PLANA };
  const apr = { etiqueta: "Aprobada v2 (A)", curva: curvaConPico(1, 0.2) };
  const base = {
    modelo: "A" as const,
    propuesta: prop,
    vigente: apr,
    comparacion: compararCurvas(apr.curva, prop.curva, true),
    avisoNoComparable: null,
    nota: "",
    onNota: () => {},
    motivosNota: [] as string[],
    puedeAprobar: true,
    motivoNoPuede: null,
    ocupado: false,
    error: null,
    aviso: null,
    onAprobar: () => {},
    onAccion: () => {},
    onCerrarError: () => {},
    onCerrarAviso: () => {},
  };

  it("con vigente: versión, datos con los que se aprobó, obsolescencia con su motivo, avisos y el botón para la versión siguiente", () => {
    const datos = trabajo({
      vigente: vigente({ version: 2, hasta_periodo: "2026-08" }),
      obsoleta: { motivos: [{ codigo: "carga_nueva", detalle: "mes publicado después y cerrado: 2026-09" }] },
      avisos_vigente: [{ codigo: "modelo_anterior", detalle: "Calculada con un modelo anterior." }],
    });
    const h = html(createElement(AprobarPanel, { ...base, datos }));
    expect(h).toContain("Vigente v2");
    expect(h).toContain("con datos hasta 2026-08");
    expect(h).toContain("Obsoleta: mes publicado después y cerrado: 2026-09");
    expect(h).toContain("Modelo anterior:");
    expect(h).toContain("EAT entre ambas");
    expect(h).toContain("Nota / motivo");
    expect(h).toContain("Aprobar esta curva (A) como versión 3");
    expect(h).not.toContain('disabled=""');
  });

  it("sin vigente: será la versión 1", () => {
    const h = html(createElement(AprobarPanel, { ...base, datos: trabajo(), vigente: null, comparacion: null }));
    expect(h).toContain("creará la versión 1");
    expect(h).toContain("Aprobar esta curva (A) como versión 1");
  });

  it("la nota obligatoria se explica con sus motivos; el botón se deshabilita con la razón visible", () => {
    const h = html(createElement(AprobarPanel, { ...base, datos: trabajo(), motivosNota: ["excluiste una tienda"], puedeAprobar: false, motivoNoPuede: "Recalculando con los parámetros nuevos: espera a que termine." }));
    expect(h).toContain("Obligatoria ahora: excluiste una tienda.");
    expect(h).toContain('disabled=""');
    expect(h).toContain("Recalculando con los parámetros nuevos");
  });

  it("un 409 se muestra con su acción sugerida y el aviso de éxito aparte", () => {
    const h = html(
      createElement(AprobarPanel, {
        ...base,
        datos: trabajo(),
        error: { mensaje: "Otra persona aprobó o retiró una curva de esta agrupación.", accion: { tipo: "recargar", etiqueta: "Volver a cargar" } },
        aviso: "Curva A aprobada como versión 3 de ABRIGO SINTÉTICO.",
      })
    );
    expect(h).toContain("Otra persona aprobó o retiró");
    expect(h).toContain("Volver a cargar");
    expect(h).toContain("Curva A aprobada como versión 3");
  });

  it("alerta con acción: un enlace a otra pantalla o un botón", () => {
    const enlace = html(createElement(AlertaAccion, { error: { mensaje: "Falta ese mes.", accion: { tipo: "enlace", etiqueta: "Ir a Venta y stock", href: "/planificacion/venta-stock" } }, onAccion: () => {}, onCerrar: () => {} }));
    expect(enlace).toContain('href="/planificacion/venta-stock"');
    const boton = html(createElement(AlertaAccion, { error: { mensaje: "Cambiaron los datos.", accion: { tipo: "recargar", etiqueta: "Volver a calcular" } }, onAccion: () => {}, onCerrar: () => {} }));
    expect(boton).toContain("<button");
    expect(boton).toContain("Volver a calcular");
    const sin = html(createElement(AlertaAccion, { error: { mensaje: "Nada que hacer.", accion: null }, onAccion: () => {}, onCerrar: () => {} }));
    expect(sin).toContain("Nada que hacer.");
  });
});

describe("lista de agrupaciones v2", () => {
  const estado: EstadoCurvasApi = {
    datos: { desde: "2023-01", hasta: "2026-09", meses_publicados: 45, faltantes: [], ultimo_mes_cerrado: "2026-09" },
    prerrequisitos_globales: [
      bloqueo("periodos_temporada_faltantes", "No hay periodos atípicos para invierno (1 agrupación).", { pantalla: "periodos" }),
      bloqueo("tienda_sin_apertura", "La tienda T04 tiene venta y no tiene fecha de apertura.", { pantalla: "tiendas", id: T1 }),
    ],
    agrupaciones: [
      agrupacion({ id: "1", nombre: "HO INVIERNO", estado: "al_dia", vigente: vigente({ eat: 0, ruido_normal: 33 }), periodos_aplicables: 2 }),
      agrupacion({ id: "2", nombre: "MU VERANO", temporada: "verano", estado: "al_dia_distinta", vigente: vigente({ modelo: "B", recomendada: false, recomendada_entonces: "A", nota: "2025 tuvo un mes raro", ruido_normal: null }), avisos_vigente: [{ codigo: "datos_posteriores", detalle: "Hay 1 mes publicado después de 2026-08." }] }),
      agrupacion({ id: "3", nombre: "INF INVIERNO", estado: "obsoleta", vigente: vigente(), obsoleta: { motivos: [{ codigo: "tienda_entra_red", detalle: "la tienda T10 entra en la red de 2026" }] } }),
      agrupacion({ id: "4", nombre: "NIÑOS INV", estado: "sin_curva", bloqueada_por: ["periodos_temporada_faltantes"] }),
      agrupacion({ id: "5", nombre: "ACC CASUAL", temporada: "todo_el_ano", estado: "sin_curva" }),
      agrupacion({ id: "6", nombre: "VIEJA", activo: false, estado: "inactiva_con_curva", vigente: vigente() }),
    ],
    periodos_atipicos: [],
    resumen: {
      agrupaciones_activas: 5,
      por_temporada: { invierno: 3, verano: 1, todo_el_ano: 1 },
      sin_revisar_toda_temporada: 1,
      con_curva_vigente: 3,
      al_dia: 1,
      al_dia_distintas: 1,
      obsoletas: 1,
      sin_curva: 2,
      bloqueadas: 1,
      bloqueadas_sin_curva: 1,
      calculables_sin_curva: 1,
      vigentes_prestadas: 0,
      inactivas_con_curva: 1,
      equivalencias_sin_agrupacion: 2,
    },
  };
  const props = {
    estado,
    cargando: false,
    agrupacionesM3: [],
    filtroTemporada: "todas" as const,
    onFiltroTemporada: () => {},
    filtroEstado: "todas" as const,
    onFiltroEstado: () => {},
    comparaciones: {},
    onComparacion: () => {},
    onTrabajar: () => {},
    onIrAPeriodos: () => {},
    onCambio: () => {},
  };

  it("resumen con bloqueadas y calculables, prerrequisitos globales con enlaces, estados, avisos por fila y acciones", () => {
    const h = html(createElement(CurvasTab, props));
    expect(h).toContain("5 agrupaciones activas · 1 con curva al día · 1 aprobada distinta de la recomendada · 1 obsoleta · 2 sin curva (1 bloqueada, 1 calculable)");
    expect(h).toContain("Antes de calcular (global)");
    expect(h).toContain("→ Periodos atípicos");
    expect(h).toContain('href="/maestros/tiendas"');
    expect(h).toContain("2 equivalencias activas no tienen");
    expect(h).toContain("Bloqueada: sin periodos para invierno");
    expect(h).toContain("distinta de la recomendada (A): se aprobó B");
    expect(h).toContain("Obsoleta");
    expect(h).toContain("la tienda T10 entra en la red de 2026");
    expect(h).toContain("Datos posteriores");
    expect(h).toContain("EAT 0.0 · ruido 33.0");
    expect(h).toContain("EAT 29.1 · ruido no medible");
    expect(h).toContain("= (A)");
    expect(h).toContain("A (vs B)");
    expect(h).toContain("Comparar con el sistema");
    expect(h).toContain("Inactiva con curva");
    expect(h).toContain("Trabajar");
    expect(h).toContain("Retirar");
    expect(h).toContain("Descargar curvas vigentes (CSV)");
    expect(h).toContain("Red comparable por año");
    // el flujo viejo ya no existe
    for (const viejo of ["Calcular todo", "Marcar como referencia", "Corrida que se ve", "Recalcular", "corrida", "Seleccionar todas", "Aprobar en bloque"]) expect(h).not.toContain(viejo);
  });

  it("«Comparar con el sistema» ya hecho: muestra el resultado de la fila sin guardar nada", () => {
    const h = html(
      createElement(CurvasTab, {
        ...props,
        comparaciones: { "3": { tipo: "comparada" as const, modelo: "A" as const, eat: 29.1, curva: PLANA, eat_vs_vigente: 4.1, difiere: true, comparable: true } },
      })
    );
    expect(h).toContain("A · difiere 4.1 pp de la vigente");
    expect(h).toContain("Volver a comparar");
  });

  it("los filtros por estado y temporada llevan su conteo", () => {
    const h = html(createElement(CurvasTab, props));
    for (const chip of ["Sin curva", "Obsoletas", "Distintas", "Al día", "Bloqueadas", "Invierno", "Verano", "Toda temporada"]) expect(h).toContain(chip);
  });

  it("cargando: sin filas todavía", () => {
    expect(html(createElement(CurvasTab, { ...props, estado: null, cargando: true }))).toContain("Cargando");
  });
});

describe("vista de trabajo, versiones y apoyo", () => {
  it("al abrir (aún sin respuesta): «Leyendo la venta de …» con el botón para volver a Agrupaciones", () => {
    const h = html(
      createElement(DetalleAgrupacion, {
        agrupacionId: T1,
        nombreInicial: "HO INVIERNO",
        colores: new Map(),
        modeloInicial: null,
        onModelo: () => {},
        vecinos: { posicion: 3, total: 15, anterior: { id: "x", nombre: "ABRIGO" }, siguiente: { id: "y", nombre: "POLO" } },
        ordenPorDefecto: false,
        onIrA: () => {},
        onVolver: () => {},
        onIrAPeriodos: () => {},
        onCambio: () => {},
      })
    );
    expect(h).toContain("← Agrupaciones");
    expect(h).toContain("Leyendo la venta de HO INVIERNO…");
    expect(h).toContain("3 de 15");
    expect(h).toContain("← Anterior");
    expect(h).toContain("Siguiente →");
  });

  const versiones: VersionesAgrupacionApi = {
    versiones: [
      { id: "c3", version: 3, estado: "vigente", modelo: "A", origen: "propia", recomendada: true, recomendada_entonces: "A", eat: 29.1, ruido_normal: 33, curva: PLANA, nota: null, aprobada_at: "2026-10-15T15:00:00Z", usuario_nombre: "Javier", foto_id: "f3", parametros_resumen: [] },
      { id: "c2", version: 2, estado: "reemplazada", modelo: "B", origen: "propia", recomendada: false, recomendada_entonces: "A", eat: 27.4, ruido_normal: null, curva: PLANA, nota: "2025 tuvo un mes raro", aprobada_at: "2026-10-14T15:00:00Z", usuario_nombre: "Javier", foto_id: "f2", parametros_resumen: ["años excluidos: 2023"] },
    ],
  };

  it("versiones: plegado muestra el resumen; con «Retirar la vigente» si hay vigente", () => {
    const h = html(createElement(VersionesPanel, { versiones: { datos: versiones, cargando: false, error: null, setError: () => {} }, ocupado: false, puedeRetirar: true, onVerFoto: () => {}, onRetirar: () => {} }));
    expect(h).toContain("Versiones (2)");
    expect(h).toContain("v3 vigente · A");
    expect(h).toContain("Retirar la vigente");
    const sin = html(createElement(VersionesPanel, { versiones: { datos: { versiones: [] }, cargando: false, error: null, setError: () => {} }, ocupado: false, puedeRetirar: false, onVerFoto: () => {}, onRetirar: () => {} }));
    expect(sin).toContain("Todavía no hay versiones aprobadas");
    expect(sin).not.toContain("Retirar la vigente");
  });

  it("«Ver foto»: un diálogo de solo lectura que dice qué foto es mientras carga", () => {
    const h = html(createElement(FotoModal, { agrupacionId: T1, version: versiones.versiones[1], versionModeloActual: 1, onCerrar: () => {} }));
    expect(h).toContain("Foto de la versión 2");
    expect(h).toContain("Cargando la foto");
    expect(h).toContain("<dialog");
  });

  it("navegar entre agrupaciones: posición, nombre de la vecina en title y aria-label, texto en los botones", () => {
    const v = { posicion: 3, total: 15, anterior: { id: "x", nombre: "ABRIGO" }, siguiente: { id: "y", nombre: "POLO" } };
    const h = html(createElement(NavegarAgrupaciones, { vecinos: v, porDefecto: false, deshabilitado: false, onIr: () => {} }));
    expect(h).toContain('aria-label="Navegar entre agrupaciones"');
    expect(h).toContain('aria-label="Agrupación anterior: ABRIGO"');
    expect(h).toContain('aria-label="Agrupación siguiente: POLO"');
    expect(h).toContain('title="Anterior: ABRIGO');
    expect(h).toContain("3 de 15");
    expect(h).not.toContain('disabled=""');
    expect(h).not.toContain("lista completa");
  });

  it("navegar: en los extremos el botón se deshabilita; con el orden por defecto lo dice", () => {
    const primera = html(createElement(NavegarAgrupaciones, { vecinos: { posicion: 1, total: 2, anterior: null, siguiente: { id: "y", nombre: "POLO" } }, porDefecto: true, deshabilitado: false, onIr: () => {} }));
    expect(primera.match(/disabled=""/g)).toHaveLength(1);
    expect(primera).toContain("No hay agrupación anterior");
    expect(primera).toContain("1 de 2 · lista completa");
    const ultima = html(createElement(NavegarAgrupaciones, { vecinos: { posicion: 2, total: 2, anterior: { id: "x", nombre: "ABRIGO" }, siguiente: null }, porDefecto: false, deshabilitado: false, onIr: () => {} }));
    expect(ultima).toContain("No hay agrupación siguiente");
    const ocupado = html(createElement(NavegarAgrupaciones, { vecinos: { posicion: 2, total: 3, anterior: { id: "x", nombre: "A" }, siguiente: { id: "y", nombre: "B" } }, porDefecto: false, deshabilitado: true, onIr: () => {} }));
    expect(ocupado.match(/disabled=""/g)).toHaveLength(2);
  });

  it("Años Niño a demanda: «Calculando…» al entrar, sin corrida de referencia", () => {
    const h = html(createElement(AniosNinoTab, { onVer: () => {} }));
    expect(h).toContain("Calculando el efecto del Niño por temporada…");
    expect(h.toLowerCase()).not.toContain("corrida");
  });

  it("red comparable por año: plegada, sin corrida ni parámetros de la tarjeta Calcular", () => {
    const h = html(createElement(RedPanel, {}));
    expect(h).toContain("Red comparable por año");
    expect(h).toContain("Plegado");
    expect(h.toLowerCase()).not.toContain("corrida");
  });
});
