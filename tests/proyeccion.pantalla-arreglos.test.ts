import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../src/lib/api-client";
import { CeldaCrecimiento, CeldaDecision } from "../src/app/(app)/planificacion/proyeccion/celda-decision";
import { ArchivarModal } from "../src/app/(app)/planificacion/proyeccion/archivar-modal";
import { BotonCancelarOCerrar, TextoOperacionEnCurso } from "../src/app/(app)/planificacion/proyeccion/comunes";
import { FormularioProyeccion } from "../src/app/(app)/planificacion/proyeccion/formulario-proyeccion";
import {
  campoDeDecision,
  claveCelda,
  ColaEnvios,
  conEstadoCelda,
  PLAZO_LECTURA_LINEA_MS,
  RecargaAgrupada,
  textoEstadoCelda,
  textoFalloLectura,
  TurnosCelda,
  type EstadoGuardadoCelda,
} from "../src/app/(app)/planificacion/proyeccion/guardado-celda-vista";
import { etiquetaBotonSecundario, formatearDuracion, textoFalloTrasCerrar, textoOperacionEnCurso } from "../src/app/(app)/planificacion/proyeccion/operacion-larga-vista";
import { textoMotivoIa, textoServicioApagado, TEXTO_IA_NO_DISPONIBLE } from "../src/app/(app)/planificacion/proyeccion/propuesta-ia-vista";
import { leerBrechaMax, textoIaCabecera } from "../src/app/(app)/planificacion/proyeccion/aprobacion-vista";
import { CODIGO_PLAZO_AGOTADO, conPlazo } from "../src/app/(app)/planificacion/proyeccion/use-proyeccion";
import { esNumeroNegativo, leerEntero, leerFactor, leerRampa, leerUmbralDisponibilidad, motivoCifraInvalida } from "../src/app/(app)/planificacion/proyeccion/vista";
import { bloqueDeGrupo, FILTROS_VACIOS } from "../src/app/(app)/planificacion/aprobacion-direccion/vista-tablero";
import { ControlesFiltros } from "../src/app/(app)/planificacion/aprobacion-direccion/filtros-tablero";
import { opciones as opcionesTablero, tablero as tableroDireccion } from "./direccion.pantalla.fixture";
import { columnasDetalle, columnasTotales, filasMatrizDetalle, filasMatrizTotales } from "../src/components/compras/matriz";
import type { ServicioIaApi } from "../src/lib/ia/tipos-api";
import { filaCamisaJhEjemplo, filaDenimEjemplo, flujoEjemplo } from "./flujo.fixture";
import { proyeccion, registro, respuestaProyeccion } from "./proyeccion.pantalla.fixture";

/** Arreglos de pantalla de Proyección tras el recorrido con datos reales (0.19.1): guardado sin bloqueo, plazo de lectura, negativos, motivos de IA, modales largos, flujo. */

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replaceAll("<!-- -->", "");
const nada = () => {};
const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

afterEach(() => {
  vi.useRealTimers();
});

// ─── 1. Guardado sin bloqueo ───

describe("1 · fijar una cifra: guardado visible, sin esperar la relectura", () => {
  it("la clave separa el decidido del crecimiento de la misma fila y año", () => {
    expect(campoDeDecision({ decidido: 500, origen: "manual" })).toBe("decidido");
    expect(campoDeDecision({ origen: "propuesta" })).toBe("decidido");
    expect(campoDeDecision({ decidido: null, origen: "manual" })).toBe("decidido");
    expect(campoDeDecision({ origen: "manual", crecimiento_pct: 8 })).toBe("crecimiento");
    expect(campoDeDecision({ origen: "manual", crecimiento_pct: null })).toBe("crecimiento");
    expect(claveCelda("f1", 2027, "decidido")).not.toBe(claveCelda("f1", 2027, "crecimiento"));
  });

  it("el mapa de estados es inmutable y se puede quitar una celda", () => {
    const a: ReadonlyMap<string, EstadoGuardadoCelda> = new Map();
    const b = conEstadoCelda(a, "x", { tipo: "guardando" });
    expect(a.size).toBe(0);
    expect(b.get("x")).toEqual({ tipo: "guardando" });
    expect(conEstadoCelda(b, "x", null).has("x")).toBe(false);
  });

  it("textos de la celda: guardando, guardado y el error del servidor", () => {
    expect(textoEstadoCelda({ tipo: "guardando" })).toBe("Guardando…");
    expect(textoEstadoCelda({ tipo: "guardado" })).toBe("Guardado");
    expect(textoEstadoCelda({ tipo: "error", mensaje: "La proyección está cerrada." })).toBe("No se guardó: La proyección está cerrada.");
  });

  it("carreras: solo el último envío de una celda manda (una respuesta vieja no pisa una nueva)", () => {
    const t = new TurnosCelda();
    const a1 = t.nuevo("a");
    const b1 = t.nuevo("b");
    const a2 = t.nuevo("a");
    expect(t.vigente("a", a1)).toBe(false);
    expect(t.vigente("a", a2)).toBe(true);
    expect(t.vigente("b", b1)).toBe(true);
  });

  it("los guardados van al servidor de uno en uno y en orden; un fallo no corta la cola", async () => {
    const cola = new ColaEnvios();
    const orden: string[] = [];
    let soltarPrimero: () => void = nada;
    const primero = cola.encolar(
      () =>
        new Promise<string>((ok) => {
          orden.push("inicia 1");
          soltarPrimero = () => ok("1");
        })
    );
    const segundo = cola.encolar(async () => {
      orden.push("inicia 2");
      throw new Error("rechazada");
    });
    const tercero = cola.encolar(async () => {
      orden.push("inicia 3");
      return "3";
    });
    await Promise.resolve();
    expect(orden).toEqual(["inicia 1"]);
    soltarPrimero();
    await expect(primero).resolves.toBe("1");
    await expect(segundo).rejects.toThrow("rechazada");
    await expect(tercero).resolves.toBe("3");
    expect(orden).toEqual(["inicia 1", "inicia 2", "inicia 3"]);
  });

  it("la relectura en segundo plano no se solapa: las pedidas durante una se agrupan en UNA más, con la función más reciente", async () => {
    const r = new RecargaAgrupada();
    const llamadas: string[] = [];
    let soltar: () => void = nada;
    const lenta = () =>
      new Promise<void>((ok) => {
        llamadas.push("vieja");
        soltar = ok;
      });
    const nueva = async () => {
      llamadas.push("nueva");
    };
    r.pedir(lenta, nada);
    r.pedir(nueva, nada);
    r.pedir(nueva, nada);
    await Promise.resolve();
    expect(llamadas).toEqual(["vieja"]);
    soltar();
    await new Promise((ok) => setTimeout(ok, 0));
    expect(llamadas).toEqual(["vieja", "nueva"]);
  });

  it("si la relectura falla, se avisa (no se traga)", async () => {
    const r = new RecargaAgrupada();
    const alFallar = vi.fn();
    r.pedir(() => Promise.reject(new Error("sin red")), alFallar);
    await new Promise((ok) => setTimeout(ok, 0));
    expect(alFallar).toHaveBeenCalledTimes(1);
  });

  it("la celda pinta su estado en una región aria-live (también vacía, para que el lector anuncie el cambio)", () => {
    const props = { anio: 2027, anioEnCurso: 2026, bloqueada: false, ocupado: false, onDecidir: async () => true, etiqueta: "RECONOCIDO, decidido 2027" };
    const guardado = html(createElement(CeldaDecision, { ...props, registro: registro(2027, { propuesto: 900 }), estado: { tipo: "guardado" } }));
    expect(guardado).toMatch(/<span role="status" aria-live="polite"[^>]*text-exito[^>]*>Guardado<\/span>/);
    const error = html(createElement(CeldaDecision, { ...props, registro: registro(2027), estado: { tipo: "error", mensaje: "Datos cambiaron." } }));
    expect(error).toMatch(/aria-live="polite"[^>]*text-alerta[^>]*>No se guardó: Datos cambiaron\.</);
    const vacio = html(createElement(CeldaDecision, { ...props, registro: registro(2027), estado: null }));
    expect(vacio).toMatch(/<span role="status" aria-live="polite"[^>]*><\/span>/);
    // Sin `estado` (otras pantallas) no hay región.
    expect(html(createElement(CeldaDecision, { ...props, registro: registro(2027) }))).not.toContain("aria-live");
    expect(html(createElement(CeldaCrecimiento, { ...props, registro: registro(2027), estado: { tipo: "guardando" } }))).toContain(">Guardando…</span>");
  });

  it("Por línea ya no espera la relectura para devolver el control y vuelve la celda atrás si el servidor rechaza", () => {
    const linea = leer("src/app/(app)/planificacion/proyeccion/linea-tab.tsx");
    const decidir = linea.slice(linea.indexOf("async function decidir("), linea.indexOf("async function aplicarCurvaLinea("));
    expect(decidir).not.toMatch(/await recargarTodo\(\)/);
    expect(decidir).toMatch(/recargarEnSegundoPlano\(\)/);
    expect(decidir).toMatch(/cola\.encolar\(/);
    expect(decidir).toMatch(/turnos\.vigente\(clave, turno\)/);
    // Los guardados ya no deshabilitan toda la tabla (no se pierde el foco al pulsar Enter).
    expect(decidir).not.toMatch(/accion\.ejecutar\(/);
    const celda = leer("src/app/(app)/planificacion/proyeccion/celda-decision.tsx");
    expect(celda).toMatch(/if \(!\(await onDecidir\(\{ decidido: l\.valor, origen: "manual" \}\)\)\) setTexto\(textoInicial\)/);
  });
});

// ─── 2. Plazo de la lectura ───

describe("2 · «Leyendo la línea…» con límite de tiempo", () => {
  it("conPlazo rechaza con `plazo_agotado` si la lectura no responde a tiempo", async () => {
    vi.useFakeTimers();
    const colgada = new Promise<string>(() => {});
    const p = conPlazo(colgada, 1000);
    const resultado = p.then(
      () => null,
      (e: unknown) => e
    );
    await vi.advanceTimersByTimeAsync(1000);
    const e = await resultado;
    expect(e).toBeInstanceOf(ErrorApi);
    expect((e as ErrorApi).codigo).toBe(CODIGO_PLAZO_AGOTADO);
    expect((e as ErrorApi).message).toMatch(/tardó demasiado/);
  });

  it("una lectura a tiempo pasa tal cual y limpia el temporizador", async () => {
    vi.useFakeTimers();
    const p = conPlazo(Promise.resolve(7), 1000);
    await expect(p).resolves.toBe(7);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Por línea lee con plazo (30 s) y el error trae «Reintentar»", () => {
    expect(PLAZO_LECTURA_LINEA_MS).toBe(30_000);
    const linea = leer("src/app/(app)/planificacion/proyeccion/linea-tab.tsx");
    expect(linea).toMatch(/useLectura<RespuestaLineasApi>\(url, false, PLAZO_LECTURA_LINEA_MS\)/);
    expect(linea).toMatch(/reintentando \? "Reintentando…" : "Reintentar"/);
    expect(textoFalloLectura("Error 504", false)).toBe("No se pudo leer la línea: Error 504.");
    expect(textoFalloLectura("Tardó demasiado.", true)).toBe("No se pudo actualizar la línea: Tardó demasiado. Lo que ves puede no estar al día; lo que ya escribiste se conserva.");
  });
});

// ─── 3. Negativos ───

describe("3 · un negativo dice que no puede ser negativo (no «sin decimales»)", () => {
  it("la cifra decidida", () => {
    expect(leerEntero("-5")).toEqual({ ok: false, motivo: "El total no puede ser negativo." });
    expect(leerEntero(" - 5 ")).toEqual({ ok: false, motivo: "El total no puede ser negativo." });
    expect(leerEntero("−5")).toEqual({ ok: false, motivo: "El total no puede ser negativo." });
    expect(leerEntero("-1,200")).toEqual({ ok: false, motivo: "El total no puede ser negativo." });
    expect(motivoCifraInvalida("-5", 0)).toBe("El total no puede ser negativo.");
    expect(leerEntero("17.5")).toEqual({ ok: false, motivo: "El total debe ser un número entero, sin decimales." });
    expect(leerEntero("abc")).toEqual({ ok: false, motivo: "El total debe ser un número entero." });
    expect(leerEntero("17,504")).toEqual({ ok: true, valor: 17504 });
  });

  it("el total de la tienda y el umbral de cola larga nombran su campo", () => {
    expect(leerEntero("-3", "El total de la tienda")).toEqual({ ok: false, motivo: "El total de la tienda no puede ser negativo." });
    expect(leerEntero("-3", "El umbral de cola larga")).toEqual({ ok: false, motivo: "El umbral de cola larga no puede ser negativo." });
    const form = leer("src/app/(app)/planificacion/proyeccion/formulario-proyeccion.tsx");
    expect(form).toMatch(/leerEntero\(cola, "El umbral de cola larga"\)/);
    const tarjeta = leer("src/app/(app)/planificacion/proyeccion/tarjeta-tienda.tsx");
    expect(tarjeta).toMatch(/leerEntero\(texto, "El total de la tienda"\)/);
  });

  it("rampa, umbral de disponibilidad y factor del Niño", () => {
    expect(leerRampa(["1", "-0.5"])).toEqual({ ok: false, motivo: "Un valor de la rampa no puede ser negativo: cada valor debe ser mayor que 0." });
    expect(leerUmbralDisponibilidad("-0.2")).toEqual({ ok: false, motivo: "El umbral de disponibilidad no puede ser negativo: debe estar entre 0 y 1." });
    const f = leerFactor("-1");
    expect(f.ok).toBe(false);
    expect(!f.ok && f.motivo).toMatch(/^El factor no puede ser negativo/);
    expect(esNumeroNegativo("-0,5")).toBe(true);
    expect(esNumeroNegativo("5")).toBe(false);
    expect(esNumeroNegativo("-abc")).toBe(false);
  });

  it("«|Brecha| hasta (%)» de Aprobación toma el valor absoluto (antes recortaba a 0 en silencio)", () => {
    expect(leerBrechaMax("-5")).toBe(5);
    expect(leerBrechaMax("12,5")).toBe(12.5);
    expect(leerBrechaMax("")).toBeNull();
    expect(leerBrechaMax("abc")).toBeNull();
    expect(leerBrechaMax("999999")).toBe(10000);
  });
});

// ─── 4. Motivos de IA ───

describe("4 · ningún código interno de la IA llega a la pantalla", () => {
  const CODIGOS = ["sin_clave", "sin_proveedor", "desactivada_entorno", "sin_configuracion", "sin_capacidades", "capacidad_apagada", "clave_invalida", "tope_mensual", "proveedor_distinto", "modelo_no_permitido", "ia_no_disponible", "codigo_nuevo_del_servidor"];

  it("cada código tiene texto; los desconocidos, el genérico", () => {
    for (const c of CODIGOS) {
      const t = textoMotivoIa(c);
      expect(t, c).not.toContain(c);
      expect(t, c).not.toMatch(/_[a-z]/);
    }
    expect(textoMotivoIa("capacidad_apagada")).toMatch(/distribución de la meta está apagada/);
    expect(textoMotivoIa("codigo_nuevo_del_servidor")).toBe(TEXTO_IA_NO_DISPONIBLE);
    expect(textoMotivoIa(null)).toBe(TEXTO_IA_NO_DISPONIBLE);
  });

  it("textoServicioApagado sigue igual para la pestaña IA y Administración", () => {
    const s = { disponible: false, motivo: "tope_mensual", gasto_mes_usd: 12.5, tope_usd_mes: 10, evaluacion: null } as unknown as ServicioIaApi;
    expect(textoServicioApagado(s)).toMatch(/^Se alcanzó el tope de gasto del mes \(/);
    expect(textoServicioApagado({ ...s, disponible: true })).toBeNull();
  });

  it("la cabecera de Aprobación traduce `sin_proveedor` y usa el año de la proyección", () => {
    const ia = { disponible: false, motivo: "sin_proveedor", corrida_en_curso: false, gms_con_propuesta: 0 };
    const t = textoIaCabecera(ia, 3, 2028).texto;
    expect(t).toBe("IA apagada: 2028 se aprueba con el método solo en GM sin IA. El servidor no tiene proveedor de IA configurado (o el configurado no tiene adaptador).");
    expect(t).not.toContain("sin_proveedor");
    expect(textoIaCabecera({ ...ia, motivo: "capacidad_apagada" }, 3).texto).not.toContain("capacidad_apagada");
  });
});

// ─── 5. Modales de operaciones largas ───

describe("5 · crear, copiar, cerrar y archivar: «Cancelar» pasa a «Cerrar» mientras corre", () => {
  it("textos: qué hace, cuánto lleva y que cerrar la ventana no la cancela", () => {
    expect(formatearDuracion(0)).toBe("0:00");
    expect(formatearDuracion(75)).toBe("1:15");
    const t = textoOperacionEnCurso("crear", 83);
    expect(t).toContain("Calculando la proyección…");
    expect(t).toContain("Lleva 1:23.");
    expect(t).toContain("el cálculo sigue en el servidor (no se puede cancelar)");
    expect(textoOperacionEnCurso("copiar", 0)).toContain("la copia sigue en el servidor");
    expect(textoOperacionEnCurso("cerrar", 5)).toContain("el cierre sigue en el servidor");
    expect(textoOperacionEnCurso("archivar", 5)).toContain("el archivado sigue en el servidor");
    expect(etiquetaBotonSecundario(false)).toBe("Cancelar");
    expect(etiquetaBotonSecundario(true)).toBe("Cerrar");
    expect(textoFalloTrasCerrar("crear", "Ya existe una proyección con ese nombre.")).toBe("No se pudo crear la proyección: Ya existe una proyección con ese nombre.");
  });

  it("el botón «Cerrar» en curso está habilitado y explica que la operación sigue", () => {
    const enCurso = html(createElement(BotonCancelarOCerrar, { enCurso: true, onCancelar: nada, onCerrarEnCurso: nada }));
    expect(enCurso).toContain(">Cerrar</button>");
    expect(enCurso).not.toContain('disabled=""');
    expect(enCurso).toContain("la operación sigue en el servidor y no se cancela");
    expect(html(createElement(BotonCancelarOCerrar, { enCurso: false, onCancelar: nada, onCerrarEnCurso: nada }))).toContain(">Cancelar</button>");
    expect(html(createElement(TextoOperacionEnCurso, { operacion: "crear", segundos: 61 }))).toContain("Lleva 1:01.");
  });

  it("los modales usan el botón nuevo (no un «Cancelar» deshabilitado) y avisan al panel si fallan tras cerrar", () => {
    const estado = respuestaProyeccion();
    const s = html(createElement(FormularioProyeccion, { estado, bloques: estado.bloques_hoy, perfiles: [], onCerrar: nada, onGuardada: nada }));
    expect(s).toMatch(/<button[^>]*>Cancelar<\/button>/);
    expect(s).not.toMatch(/<button[^>]*disabled=""[^>]*>Cancelar<\/button>/);
    expect(html(createElement(ArchivarModal, { proyeccion: proyeccion({ estado: "cerrada" }), onCerrar: nada, onArchivada: nada }))).toMatch(/<button[^>]*>Cancelar<\/button>/);
    for (const archivo of ["formulario-proyeccion.tsx", "cerrar-modal.tsx", "archivar-modal.tsx"]) {
      const src = leer(`src/app/(app)/planificacion/proyeccion/${archivo}`);
      expect(src, archivo).toContain("<BotonCancelarOCerrar");
      expect(src, archivo).toMatch(/if \(!operacionLarga\.seCerro\(\)\) onCerrar\(\)/);
      expect(src, archivo).toMatch(/onFalloTrasCerrar\?\.\(textoFalloTrasCerrar\(/);
    }
    const panel = leer("src/app/(app)/planificacion/proyeccion/proyeccion-panel.tsx");
    expect(panel.match(/onFalloTrasCerrar=\{falloTrasCerrar\}/g)).toHaveLength(4);
  });
});

// ─── 6. Investigación: Mismas tiendas (tablero de dirección) y exceso en el flujo ───

describe("6b · tablero de dirección: el grupo «Mismas tiendas» se elige como bloque entero", () => {
  it("mismas y cierres corresponden 1:1 a un bloque; los demás grupos no", () => {
    expect(bloqueDeGrupo("mismas")).toBe("mismas");
    expect(bloqueDeGrupo("cierres")).toBe("cierres");
    expect(bloqueDeGrupo("aperturas")).toBeNull();
    expect(bloqueDeGrupo("nuevas_anterior")).toBeNull();
    expect(bloqueDeGrupo("todas")).toBeNull();
  });
  it("junto al título «Mismas tiendas 2027» hay un botón que elige el bloque entero (el título solo no es una opción)", () => {
    const s = html(createElement(ControlesFiltros, { filtros: FILTROS_VACIOS, opciones: opcionesTablero(), tablero: tableroDireccion(), onCambiar: nada }));
    expect(s).toMatch(/Mismas tiendas 2027<\/span><button type="button" aria-pressed="false"[^>]*>Ver el bloque entero<\/button>/);
    const activo = html(createElement(ControlesFiltros, { filtros: { ...FILTROS_VACIOS, bloque: "mismas" }, opciones: opcionesTablero(), tablero: tableroDireccion(), onCambiar: nada }));
    expect(activo).toMatch(/aria-pressed="true"[^>]*>Viendo el bloque entero</);
  });
});

describe("6c · flujo: el exceso se rotula como suma (no se compensa con el quiebre)", () => {
  const ctx = { imiMin: 4, imiMax: 8 };

  it("totales: «suma de las filas», como el saldo", () => {
    const flujo = flujoEjemplo();
    const exceso = filasMatrizTotales(flujo.totales, columnasTotales(flujo.datos.periodos), ctx).find((f) => f.clave === "exceso");
    expect(exceso?.etiqueta).toBe("Exceso (suma de las filas, sobre 8 meses)");
    expect(exceso?.ayuda).toMatch(/puede haber exceso aunque el stock del conjunto sea negativo/);
  });

  it("fila con marcas aparte: «suma de las partes»; sin ellas, el rótulo de siempre", () => {
    const jh = filaCamisaJhEjemplo();
    expect(filasMatrizDetalle(jh, columnasDetalle(jh, 3), ctx).find((f) => f.clave === "exceso")?.etiqueta).toBe("Exceso (suma de las partes, sobre 8 meses)");
    const denim = filaDenimEjemplo();
    expect(filasMatrizDetalle(denim, columnasDetalle(denim, 3), ctx).find((f) => f.clave === "exceso")?.etiqueta).toBe("Exceso (sobre 8 meses)");
  });
});
