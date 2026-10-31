import { describe, expect, it } from "vitest";
import { ErrorApi } from "../src/lib/api-client";
import type { MotivoServicioIa, PasoGMApi } from "../src/lib/ia/tipos-api";
import {
  ESTADO_GM,
  cuerpoIniciarCorrida,
  destinoLinea,
  estimacionDeError,
  fechaCorta,
  fraccionAvance,
  gmPendiente,
  idsDeGm,
  claveGmValida,
  leerSeleccion,
  lineaServicioEncendido,
  llevaAFactores,
  nivelBrecha,
  nivelEsfuerzo,
  ordenarFilasPorDistanciaAlMetodo,
  ordenarGms,
  permiteGenerar,
  signado,
  superaTope,
  textoAbsorcionFila,
  textoAbsorcionGm,
  textoDesgloseAbsorcion,
  textoEstadoGm,
  textoGenerada,
  textoMeta,
  textoMetaDetalle,
  textoPrerrequisito,
  textoResumenCorrida,
  textoServicioApagado,
  textoTopes,
  totalesDeFilas,
  totalesPorLinea,
  usd,
  valorSeleccion,
  type AvanceGm,
} from "../src/app/(app)/planificacion/proyeccion/propuesta-ia-vista";
import { MAX_PASOS_POR_GM, REINTENTOS_CANDADO, conducirPasos, corridaTerminadaPorServidor, esperaSegura, type ItemPaso } from "../src/app/(app)/planificacion/proyeccion/use-propuesta-ia";
import { unidades } from "../src/app/(app)/planificacion/proyeccion/vista";
import {
  ETIQUETA_CAPACIDAD,
  MENSAJE_TERMINOS_REQUERIDOS,
  TEXTOS_PROMPT,
  capacidadHabilitable,
  diaCorto,
  duracionTexto,
  evaluacionesElegibles,
  formDesdeVigente,
  formEvaluacionInicial,
  leerNumero,
  leerTerminos,
  mejoraTexto,
  nombreMes,
  tablasInforme,
  terminosObligatorios,
  textoAvisoConfiguracion,
  textoClavePresente,
  textoErrorConfiguracion,
  textoIc90,
  textoIntentoNuevo,
  textoReglaQueFallo,
  validarConfiguracion,
  validarEvaluacion,
  versionesEvaluadasEnOrden,
  wapeTexto,
} from "../src/app/(app)/administracion/ia/ia-vista";
import {
  CLAVE_HOMBRE_URBANO,
  CLAVE_MUJER_RESTO,
  CLAVE_MUJER_URBANO,
  configuracion,
  corrida,
  estadoIa,
  estimacion,
  evaluacion,
  evaluacionNoGana,
  filasDetalle,
  gmDetalle,
  gmMujerUrbano,
  gmResto,
  gmResumen,
  paso,
  propuestaResumen,
  resultados,
  servicio,
  servicioApagado,
} from "./ia.pantalla.fixture";

/** Lógica de vista de la pestaña «Propuesta IA» y de Administración → Motor de IA (07e §4.1 y §4.5). Datos sintéticos y sin red. */

describe("cabecera de servicio", () => {
  it("encendida: proveedor, modelo, prompt, meta, evaluación, gasto del mes y de hoy", () => {
    const t = lineaServicioEncendido(servicio(), 2027);
    expect(t).toContain("IA encendida");
    expect(t).toContain("OpenAI");
    expect(t).toContain("modelo modelo-a");
    expect(t).toContain("prompt v1");
    expect(t).toContain("meta 2027");
    expect(t).toContain("evaluada el 02/11");
    expect(t).toContain("gasto del mes US$ 3.20 de 60");
    expect(t).toContain("hoy US$ 0.40 de 15");
    expect(textoServicioApagado(servicio())).toBeNull();
  });

  it("apagada: dice el motivo de cada caso y qué hacer", () => {
    const casos: Record<MotivoServicioIa, RegExp> = {
      sin_clave: /Falta la clave del proveedor en el servidor/,
      sin_proveedor: /no tiene proveedor de IA configurado/,
      desactivada_entorno: /desactivada por el entorno/,
      sin_configuracion: /Todavía no hay una configuración de IA aprobada/,
      sin_capacidades: /Apagada por el administrador/,
      clave_invalida: /rechazó la clave/,
      tope_mensual: /tope de gasto del mes/,
      proveedor_distinto: /otro proveedor o de un modelo no permitido/,
      modelo_no_permitido: /otro proveedor o de un modelo no permitido/,
    };
    for (const [motivo, re] of Object.entries(casos) as [MotivoServicioIa, RegExp][]) {
      expect(textoServicioApagado(servicioApagado(motivo)), motivo).toMatch(re);
    }
  });

  it("sin capacidades con una evaluación que no ganó: «Sin evaluación ganadora»", () => {
    const s = servicioApagado("sin_capacidades", { evaluacion: { id: "ev-2", fecha: "2026-11-02T15:00:00Z", veredicto: { distribucion_y1: "no_gana" } } });
    expect(textoServicioApagado(s)).toMatch(/Sin evaluación ganadora: en la evaluación del 02\/11/);
  });

  it("los topes dicen lo que queda, sin pasarse de cero", () => {
    expect(textoTopes(servicio())).toEqual(["Tope por corrida: US$ 10.00", "Queda del mes: US$ 56.80", "Queda hoy: US$ 14.60"]);
    expect(textoTopes(servicio({ gasto_mes_usd: 70 }))[1]).toBe("Queda del mes: US$ 0.00");
  });

  it("formatos: dinero, signo y fecha en Lima", () => {
    expect(usd(3.2)).toBe("US$ 3.20");
    expect(usd(0.004)).toBe("< US$ 0.01");
    expect(usd(null)).toBe("—");
    expect(signado(-1039)).toBe(`-${unidades(1039)}`);
    expect(signado(309)).toBe(`+${unidades(309)}`);
    expect(signado(0)).toBe("0");
    expect(fechaCorta("2026-11-02T03:00:00Z")).toBe("01/11");
  });
});

describe("prerrequisitos", () => {
  it("cada motivo tiene su texto y el factor del Niño lleva a Factores", () => {
    expect(textoPrerrequisito("factor_y")).toContain("Factores del Niño");
    expect(textoPrerrequisito("meta_provisional")).toContain("la IA reparte el % provisional");
    expect(llevaAFactores("factor_y")).toBe(true);
    expect(llevaAFactores("sin_meta")).toBe(false);
  });

  it("decisiones_y_pendientes lista cuántas filas del año en curso quedan sin decidir por GM", () => {
    const t = textoPrerrequisito("decisiones_y_pendientes", [gmResumen({ filas_y_sin_decidir: 2 }), gmMujerUrbano({ filas_y_sin_decidir: 0 })]);
    expect(t).toContain("cada cierre mueve la meta del año siguiente");
    expect(t).toContain("HOMBRE · URBANO (2)");
    expect(t).not.toContain("MUJER · URBANO");
  });

  it("generar: con el servicio apagado no se ofrece; con bloqueos, una corrida o la proyección bloqueada, tampoco", () => {
    expect(permiteGenerar(estadoIa(), false)).toEqual({ ok: true, motivo: null });
    expect(permiteGenerar(estadoIa({ servicio: servicioApagado("sin_clave") }), false).ok).toBe(false);
    expect(permiteGenerar(estadoIa(), true).ok).toBe(false);
    expect(permiteGenerar(estadoIa({ prerrequisitos: { bloquea: ["version_metodo"], avisa: [] } }), false).ok).toBe(false);
    expect(permiteGenerar(estadoIa({ corrida_en_curso: corrida() }), false).motivo).toBe("Hay una corrida en curso.");
  });
});

describe("tabla de GM", () => {
  it("HOMBRE y MUJER primero y el Resto agrupado al final", () => {
    const orden = ordenarGms([gmResto(), gmMujerUrbano(), gmResumen()]).map((g) => g.gm_clave);
    expect(orden).toEqual([CLAVE_HOMBRE_URBANO, CLAVE_MUJER_URBANO, CLAVE_MUJER_RESTO]);
  });

  it("esfuerzo: normal hasta +10 %, exigente desde +10, muy exigente desde +25, holgada desde -5 %", () => {
    expect(nivelEsfuerzo(2.8).nivel).toBe("normal");
    expect(nivelEsfuerzo(10).nivel).toBe("exigente");
    expect(nivelEsfuerzo(24.9).nivel).toBe("exigente");
    expect(nivelEsfuerzo(25).nivel).toBe("muy_exigente");
    expect(nivelEsfuerzo(-5).nivel).toBe("holgado");
    expect(nivelEsfuerzo(-4.9).nivel).toBe("normal");
    expect(nivelEsfuerzo(null).nivel).toBe("sin_dato");
    expect(nivelEsfuerzo(30).tono).toBe("alerta");
    expect(nivelEsfuerzo(-8).tono).toBe("marca");
  });

  it("brecha: forzada desde +10 %, muy forzada desde +25 %, cede desde -10 %", () => {
    expect(nivelBrecha(9.9).texto).toBeNull();
    expect(nivelBrecha(10).texto).toBe("forzada");
    expect(nivelBrecha(25).texto).toBe("muy forzada");
    expect(nivelBrecha(-10).texto).toBe("cede");
    expect(nivelBrecha(-9.9).texto).toBeNull();
    expect(nivelBrecha(null).nivel).toBe("sin_dato");
  });

  it("estados: texto con motivo cuando está desactualizada y pendientes para regenerar", () => {
    expect(textoEstadoGm({ estado: "desactualizada", motivos: ["historia_cambiada", "filas_libres_nuevas"] })).toBe("desactualizada (la historia cambió, hay filas libres nuevas)");
    expect(textoEstadoGm({ estado: "al_dia", motivos: [] })).toBe("al día");
    expect(ESTADO_GM.meta_movida.tono).toBe("alerta");
    expect(gmPendiente({ estado: "sin_propuesta" })).toBe(true);
    expect(gmPendiente({ estado: "al_dia" })).toBe(false);
    expect(gmPendiente({ estado: "meta_movida" })).toBe(false);
  });

  it("meta: «+8.00 % sobre corregido · 26 006 u» y la tarjeta del detalle", () => {
    expect(textoMeta(gmResumen().meta)).toBe(`+8.00 % sobre corregido · ${unidades(26006)} u`);
    expect(textoMeta(null)).toBe("sin meta");
    const t = textoMetaDetalle(gmResumen()) ?? "";
    expect(t).toContain(`Meta ${unidades(26006)} u = Σ propuesta del método con +8.00 % sobre corregido`);
    expect(t).toContain(`fijas ${unidades(3386)} u (decididas ${unidades(3300)} · cola larga 86)`);
    expect(t).toContain(`libre ${unidades(22620)}`);
    expect(t).toContain(`natural IA ${unidades(22000)}`);
    expect(t).toContain("→ esfuerzo +2.8 %");
    expect(textoMetaDetalle(gmResumen({ meta: null }))).toBeNull();
  });

  it("absorción del GM: ámbar si pasa del 5 % y desglose con las cuatro cifras", () => {
    const a = gmMujerUrbano().absorcion;
    expect(textoAbsorcionGm(a)).toEqual({ texto: `-${unidades(1039)} u (-8.9 %) desde que la IA propuso`, alerta: true });
    expect(textoAbsorcionGm({ delta_meta_u: 0, desviacion_fijadas_u: 0, otros_u: 0, absorbido_u: 10, absorbido_pct: 0.4 })?.alerta).toBe(false);
    expect(textoAbsorcionGm(null)).toBeNull();
    const d = textoDesgloseAbsorcion(a!);
    expect(d).toContain("la meta cambió 0 u");
    expect(d).toContain(`las filas fijadas después se apartaron +${unidades(1039)} u`);
    expect(d).toContain(`las libres que quedan absorbieron -${unidades(1039)} u (-8.9 %)`);
  });

  it("generada: fecha, quién, proveedor y modelo, prompt y costo", () => {
    const t = textoGenerada(propuestaResumen());
    expect(t).toContain("Ana Planner");
    expect(t).toContain("OpenAI modelo-a");
    expect(t).toContain("prompt v1");
    expect(t).toContain("US$ 0.12");
    expect(textoGenerada(null)).toBe("—");
  });
});

describe("filas del detalle", () => {
  it("se ordenan por |IA con meta − método| descendente (primero donde más se aparta)", () => {
    const orden = ordenarFilasPorDistanciaAlMetodo(filasDetalle()).map((f) => f.fila_id);
    expect(orden).toEqual(["fila-camisa", "fila-denim", "fila-polo", "fila-fija"]);
  });

  it("la absorción por fila es ámbar solo con el aviso absorcion_alta", () => {
    const [denim, polo] = [filasDetalle()[1], filasDetalle()[0]];
    expect(textoAbsorcionFila(denim)?.alerta).toBe(true);
    expect(textoAbsorcionFila(polo)?.alerta).toBe(false);
    expect(textoAbsorcionFila({ absorbido_u: null, absorbido_pct: null, avisos: [] })).toBeNull();
  });

  it("totales del GM y por línea (sin inventar cifras donde no hay)", () => {
    const t = totalesDeFilas(filasDetalle());
    expect(t.meta_y1).toBe(6400 + 11700 + 4100);
    expect(t.metodo_y1).toBe(6480 + 10800 + 5400 + 3240);
    const lineas = totalesPorLinea(filasDetalle());
    expect(lineas.map((l) => l.linea)).toEqual(["CAMISA", "DENIM", "POLO"]);
    expect(lineas.find((l) => l.linea === "POLO")).toMatchObject({ filas: 2, meta_y1: 6400, vigente_y1: 6480 + 3300 });
  });

  it("el Excel de la pestaña ordena igual que la pantalla (misma regla)", async () => {
    const { hojaFilasPropuestaIa } = await import("../src/lib/ia/excel");
    const hoja = hojaFilasPropuestaIa([gmDetalle()], 2026);
    const lineas = hoja.slice(1).map((f) => f[1]);
    expect(lineas).toEqual(ordenarFilasPorDistanciaAlMetodo(gmDetalle().filas).map((f) => f.linea));
  });
});

describe("navegación", () => {
  it("la clave del GM es <genero>.<mundo> y se descarta lo raro", () => {
    expect(claveGmValida(CLAVE_HOMBRE_URBANO)).toBe(true);
    expect(claveGmValida("../etc/passwd")).toBe(false);
    expect(claveGmValida("sin-punto")).toBe(false);
    expect(claveGmValida(null)).toBe(false);
    expect(idsDeGm(CLAVE_HOMBRE_URBANO)).toEqual({ genero_id: "gen-hombre", mundo_id: "mun-urbano" });
    expect(idsDeGm("x")).toBeNull();
  });

  it("«Ir a la línea» resuelve la línea por su nombre dentro del GM", () => {
    const indice = [
      { genero_id: "gen-hombre", mundo_id: "mun-urbano", linea_id: "lin-denim", genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", estado: "con_propuesta" },
      { genero_id: "gen-mujer", mundo_id: "mun-urbano", linea_id: "lin-denim-m", genero: "MUJER", mundo: "URBANO", linea: "DENIM", estado: "con_propuesta" },
    ] as unknown as Parameters<typeof destinoLinea>[2];
    expect(destinoLinea(CLAVE_HOMBRE_URBANO, "DENIM", indice)).toEqual({ genero_id: "gen-hombre", mundo_id: "mun-urbano", linea_id: "lin-denim" });
    expect(destinoLinea(CLAVE_HOMBRE_URBANO, "POLO", indice)?.linea_id).toBeNull();
    expect(destinoLinea("raro", "DENIM", indice)).toBeNull();
  });
});

describe("corrida: selección, cuerpo y estimación", () => {
  it("el valor del selector de GM va y vuelve", () => {
    expect(leerSeleccion("pendientes")).toBe("pendientes");
    expect(leerSeleccion("todos")).toBe("todos");
    expect(leerSeleccion(`gm:${CLAVE_MUJER_URBANO}`)).toEqual([CLAVE_MUJER_URBANO]);
    expect(leerSeleccion("gm:../x")).toBe("pendientes");
    expect(valorSeleccion([CLAVE_MUJER_URBANO])).toBe(`gm:${CLAVE_MUJER_URBANO}`);
    expect(valorSeleccion("todos")).toBe("todos");
  });

  it("el cuerpo del POST es el de iniciarCorridaSchema", () => {
    expect(cuerpoIniciarCorrida("pendientes", false, 3.6)).toEqual({ gms: "pendientes", regenerar: false, costo_confirmado_usd: 3.6 });
    expect(cuerpoIniciarCorrida([CLAVE_MUJER_URBANO], true, 0)).toEqual({ gms: [CLAVE_MUJER_URBANO], regenerar: true, costo_confirmado_usd: 0 });
  });

  it("la estimación de un 409 costo_no_confirmado se lee solo si es completa", () => {
    expect(estimacionDeError({ estimacion: estimacion() })).toEqual(estimacion());
    expect(estimacionDeError({ estimacion: { gms: 1 } })).toBeNull();
    expect(estimacionDeError({})).toBeNull();
    expect(estimacionDeError(null)).toBeNull();
  });

  it("pasar del tope por corrida se detecta", () => {
    expect(superaTope(estimacion({ costo_usd: 11 }))).toBe(true);
    expect(superaTope(estimacion({ costo_usd: 3.6 }))).toBe(false);
  });

  it("resumen: «27 GM al día · 1 fallido · 1 sin filas libres · US$ 3.12»", () => {
    const porGm: Record<string, AvanceGm> = {};
    for (let i = 0; i < 27; i++) porGm[`g${i}`] = { estado: i % 2 ? "hecho" : "reusado", pasos_hechos: 2, pasos_total: 2 };
    porGm.f = { estado: "fallido", pasos_hechos: 1, pasos_total: 2 };
    porGm.s = { estado: "sin_filas_libres", pasos_hechos: 0, pasos_total: 0 };
    expect(textoResumenCorrida(porGm, { costo_usd: 3.12 })).toBe("27 GM al día · 1 fallido · 1 sin filas libres · US$ 3.12");
    expect(textoResumenCorrida({ a: { estado: "pendiente", pasos_hechos: 0, pasos_total: 0 } }, null)).toBe("0 GM al día · 1 sin terminar");
  });

  it("el avance de un GM va de 0 a 1", () => {
    expect(fraccionAvance({ pasos_hechos: 1, pasos_total: 4 })).toBe(0.25);
    expect(fraccionAvance({ pasos_hechos: 5, pasos_total: 4 })).toBe(1);
    expect(fraccionAvance({ pasos_hechos: 0, pasos_total: 0 })).toBe(0);
    expect(fraccionAvance(undefined)).toBe(0);
  });
});

describe("el bucle de pasos que conduce el navegador", () => {
  const plan: ItemPaso[] = [{ gm_clave: "a.b" }, { gm_clave: "c.d" }];
  const respuestas = (...rs: (PasoGMApi | Error)[]) => {
    const cola = [...rs];
    const llamadas: { url: string; cuerpo: unknown }[] = [];
    const esperas: number[] = [];
    return {
      llamadas,
      esperas,
      opciones: {
        items: plan,
        urlPaso: (i: ItemPaso) => `/p/${i.gm_clave}/paso`,
        cuerpoPaso: () => ({}),
        llamar: async <T,>(url: string, cuerpo: unknown) => {
          llamadas.push({ url, cuerpo });
          const r = cola.shift();
          if (!r) throw new Error("sin respuesta preparada");
          if (r instanceof Error) throw r;
          return r as T;
        },
        esperar: async (ms: number) => void esperas.push(ms),
        detenida: () => false,
        alPaso: () => undefined,
      },
    };
  };
  const p = (extra: Partial<PasoGMApi>) => paso(extra);

  it("repite el paso mientras diga continuar y pasa al GM siguiente cuando dice hecho", async () => {
    const t = respuestas(p({ siguiente: "continuar" }), p({ siguiente: "hecho", estado: "hecho" }), p({ gm_clave: "c.d", siguiente: "hecho", estado: "reusado" }));
    expect(await conducirPasos(t.opciones)).toEqual({ fin: "completo" });
    expect(t.llamadas.map((l) => l.url)).toEqual(["/p/a.b/paso", "/p/a.b/paso", "/p/c.d/paso"]);
  });

  it("un 429 del proveedor no es un error: espera lo que pidió el servidor (acotado) y vuelve a llamar", async () => {
    const t = respuestas(p({ siguiente: "esperar", esperar_ms: 4000 }), p({ siguiente: "esperar", esperar_ms: 10 }), p({ siguiente: "hecho", estado: "hecho" }), p({ siguiente: "hecho", estado: "hecho" }));
    expect(await conducirPasos(t.opciones)).toEqual({ fin: "completo" });
    expect(t.esperas).toEqual([4000, 500]);
    expect(esperaSegura(null)).toBe(2000);
    expect(esperaSegura(9_999_999)).toBe(120_000);
  });

  it("un GM fallido no detiene a los demás", async () => {
    const t = respuestas(p({ siguiente: "fallido", estado: "fallido" }), p({ siguiente: "hecho", estado: "hecho" }));
    expect(await conducirPasos(t.opciones)).toEqual({ fin: "completo" });
  });

  it("gm_en_proceso (candado) se reintenta unas veces y luego se muestra", async () => {
    const candado = () => new ErrorApi("Otro paso está en curso.", 409, "gm_en_proceso");
    const ok = respuestas(candado(), candado(), p({ siguiente: "hecho", estado: "hecho" }), p({ siguiente: "hecho", estado: "hecho" }));
    expect(await conducirPasos(ok.opciones)).toEqual({ fin: "completo" });
    expect(ok.esperas).toHaveLength(2);
    const mal = respuestas(...Array.from({ length: REINTENTOS_CANDADO + 1 }, candado));
    const r = await conducirPasos(mal.opciones);
    expect(r).toMatchObject({ fin: "error", error: { codigo: "gm_en_proceso", mensaje: "Otro paso está en curso." } });
  });

  it("un error de la API (tope, datos cambiaron…) detiene todo y se devuelve con su código", async () => {
    const t = respuestas(new ErrorApi("Se alcanzó el tope de la corrida.", 409, "tope_corrida", { codigo: "tope_corrida" }));
    const r = await conducirPasos(t.opciones);
    expect(r).toMatchObject({ fin: "error", item: { gm_clave: "a.b" }, error: { codigo: "tope_corrida", mensaje: "Se alcanzó el tope de la corrida." } });
    expect(t.llamadas).toHaveLength(1);
    expect(corridaTerminadaPorServidor("tope_corrida")).toBe(true);
    expect(corridaTerminadaPorServidor("red")).toBe(false);
    expect(corridaTerminadaPorServidor(null)).toBe(false);
  });

  it("detener se atiende entre pasos y no llama más", async () => {
    const t = respuestas(p({ siguiente: "continuar" }));
    let pedido = false;
    const r = await conducirPasos({ ...t.opciones, detenida: () => pedido, alPaso: () => void (pedido = true) });
    expect(r).toEqual({ fin: "detenido" });
    expect(t.llamadas).toHaveLength(1);
  });

  it("no gira para siempre: un GM que nunca termina se corta", async () => {
    const infinito = { ...respuestas().opciones, llamar: async <T,>() => p({ siguiente: "continuar" }) as T };
    const r = await conducirPasos(infinito);
    expect(r).toMatchObject({ fin: "error", error: { codigo: "demasiados_pasos" } });
    expect(MAX_PASOS_POR_GM).toBeGreaterThan(10);
  });

  it("antesDeGm (preparar un pliegue) corre una vez por GM y su error se devuelve", async () => {
    const visto: string[] = [];
    const t = respuestas(p({ siguiente: "hecho", estado: "hecho" }), p({ siguiente: "hecho", estado: "hecho" }));
    await conducirPasos({ ...t.opciones, antesDeGm: async (i) => void visto.push(i.gm_clave) });
    expect(visto).toEqual(["a.b", "c.d"]);
    const falla = respuestas();
    const r = await conducirPasos({ ...falla.opciones, antesDeGm: async () => Promise.reject(new ErrorApi("Sin datos del pliegue.", 409, "sin_datos_pliegue")) });
    expect(r).toMatchObject({ fin: "error", error: { codigo: "sin_datos_pliegue" } });
    expect(falla.llamadas).toHaveLength(0);
  });
});

// ─── Administración ───

describe("administración: números y formulario", () => {
  it("lee números como los escribe una persona y nada más", () => {
    expect(leerNumero("1.5")).toBe(1.5);
    expect(leerNumero(" 2,25 ")).toBe(2.25);
    expect(leerNumero("1e3")).toBeNull();
    expect(leerNumero("1,000.50")).toBeNull();
    expect(leerNumero("-1")).toBeNull();
    expect(leerNumero("")).toBeNull();
    expect(leerNumero("abc")).toBeNull();
  });

  it("términos: uno por línea, sin vacíos ni repetidos (sin distinguir mayúsculas)", () => {
    expect(leerTerminos("EMPRESA X\n\n  empresa x \nSIGLA\r\nOtro")).toEqual(["EMPRESA X", "SIGLA", "Otro"]);
  });

  it("sin versión vigente el formulario parte con los defectos de la ficha, el primer modelo permitido y precios vacíos", () => {
    const f = formDesdeVigente(null, ["modelo-a", "modelo-b"], ["v1"]);
    expect(f).toMatchObject({ modelo: "modelo-a", version_prompt: "v1", capacidades: [], tope_usd_corrida: "10", tope_usd_mes: "60", tope_usd_dia_usuario: "15", max_filas_llamada: "60", presupuesto_razonamiento: "0", precio_entrada: "", precio_salida: "" });
    expect(f.incluir_cola_larga).toBe(false);
  });

  it("con versión vigente parte de ella", () => {
    const f = formDesdeVigente(configuracion(), ["modelo-a"], ["v1"]);
    expect(f).toMatchObject({ evaluacion_id: "ev-1", capacidades: ["distribucion_y1"], precio_entrada: "1.5", precio_entrada_cache: "0.75", precio_salida: "6", terminos_extra: "EMPRESA X" });
  });

  const ctx = { modelosPermitidos: ["modelo-a", "modelo-b"], prompts: ["v1"], versionVigente: 2 };

  it("valida con los rangos del esquema y arma el cuerpo (sin proveedor: lo pone el servidor)", () => {
    const r = validarConfiguracion(formDesdeVigente(configuracion(), ctx.modelosPermitidos, ctx.prompts), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cuerpo).toMatchObject({
      modelo: "modelo-a",
      version_prompt: "v1",
      capacidades: ["distribucion_y1"],
      evaluacion_id: "ev-1",
      tope_usd_corrida: 10,
      precios: { entrada: 1.5, entrada_cache: 0.75, salida: 6 },
      terminos_extra: ["EMPRESA X"],
      version_vigente: 2,
    });
    expect("proveedor" in r.cuerpo).toBe(false);
    expect("nota" in r.cuerpo).toBe(false);
  });

  it("rechaza precios vacíos, caché mayor que la entrada, modelo fuera de la lista, topes fuera de rango y capacidad sin evaluación", () => {
    const base = formDesdeVigente(null, ctx.modelosPermitidos, ctx.prompts);
    const vacio = validarConfiguracion(base, ctx);
    expect(vacio.ok).toBe(false);
    if (!vacio.ok) expect(vacio.errores.join(" ")).toContain("Precio de entrada");
    const malo = validarConfiguracion({ ...base, modelo: "otro", precio_entrada: "1", precio_entrada_cache: "2", precio_salida: "3", tope_usd_corrida: "501", max_filas_llamada: "5", presupuesto_razonamiento: "40000", capacidades: ["distribucion_y1"] }, ctx);
    expect(malo.ok).toBe(false);
    if (!malo.ok) {
      const t = malo.errores.join(" | ");
      expect(t).toContain("Elige un modelo");
      expect(t).toContain("en caché");
      expect(t).toContain("Tope por corrida");
      expect(t).toContain("Filas por llamada");
      expect(t).toContain("Razonamiento");
      expect(t).toContain("evaluación ganadora");
    }
  });

  it("términos de largo inválido y nota larga se rechazan", () => {
    const base = { ...formDesdeVigente(configuracion(), ctx.modelosPermitidos, ctx.prompts), capacidades: [], evaluacion_id: "" };
    const r = validarConfiguracion({ ...base, terminos_extra: "x\nBien", nota: "n".repeat(301) }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.join(" ")).toMatch(/entre 2 y 60/);
    if (!r.ok) expect(r.errores.join(" ")).toMatch(/300 caracteres/);
  });

  it("el precio de entrada en caché admite 0 y no puede pasar del de entrada (configuración y evaluación igual)", () => {
    const base = formDesdeVigente(configuracion(), ctx.modelosPermitidos, ctx.prompts);
    const cero = validarConfiguracion({ ...base, precio_entrada_cache: "0" }, ctx);
    expect(cero.ok).toBe(true);
    if (cero.ok) expect(cero.cuerpo.precios.entrada_cache).toBe(0);
    expect(validarConfiguracion({ ...base, precio_entrada_cache: "1.5" }, ctx).ok).toBe(true); // igual a la entrada
    const mayor = validarConfiguracion({ ...base, precio_entrada_cache: "1.51" }, ctx);
    expect(mayor.ok).toBe(false);
    if (!mayor.ok) expect(mayor.errores.join(" ")).toContain("no puede ser mayor que el precio de entrada");
    expect(validarConfiguracion({ ...base, precio_entrada_cache: "" }, ctx).ok).toBe(false);
    expect(validarConfiguracion({ ...base, precio_entrada_cache: "-1" }, ctx).ok).toBe(false);
    // La entrada y la salida siguen exigiendo más que 0.
    expect(validarConfiguracion({ ...base, precio_entrada: "0", precio_entrada_cache: "0" }, ctx).ok).toBe(false);
    expect(validarConfiguracion({ ...base, precio_salida: "0" }, ctx).ok).toBe(false);

    const ev = formEvaluacionInicial(configuracion(), ctx.modelosPermitidos, ctx.prompts);
    expect(validarEvaluacion({ ...ev, precio_entrada_cache: "0" }, ctx).ok).toBe(true);
    const evMayor = validarEvaluacion({ ...ev, precio_entrada_cache: "9" }, ctx);
    expect(evMayor.ok).toBe(false);
    if (!evMayor.ok) expect(evMayor.errores.join(" ")).toContain("no puede ser mayor que el precio de entrada");
  });

  it("con alguna capacidad encendida, `terminos_extra` es obligatorio (el nombre de la empresa); sin capacidades puede ir vacío", () => {
    const base = formDesdeVigente(configuracion(), ctx.modelosPermitidos, ctx.prompts);
    expect(terminosObligatorios(["distribucion_y1"])).toBe(true);
    expect(terminosObligatorios([])).toBe(false);
    const sin = validarConfiguracion({ ...base, terminos_extra: " \n  \n" }, ctx);
    expect(sin.ok).toBe(false);
    if (!sin.ok) expect(sin.errores).toContain(MENSAJE_TERMINOS_REQUERIDOS);
    expect(MENSAJE_TERMINOS_REQUERIDOS).toContain("nombre de la empresa");
    expect(validarConfiguracion({ ...base, terminos_extra: "EMPRESA X" }, ctx).ok).toBe(true);
    expect(validarConfiguracion({ ...base, capacidades: [], evaluacion_id: "", terminos_extra: "" }, ctx).ok).toBe(true);
  });

  it("el código `terminos_extra_requeridos` del servidor se explica; otros errores conservan su mensaje", () => {
    expect(textoErrorConfiguracion("terminos_extra_requeridos", "seco")).toBe(MENSAJE_TERMINOS_REQUERIDOS);
    expect(textoErrorConfiguracion("vigente_cambiada", "La vigente cambió.")).toBe("La vigente cambió.");
    expect(textoErrorConfiguracion(null, "Error")).toBe("Error");
  });

  it("el aviso `modelo_efectivo_distinto` dice con claridad que el proveedor respondió con otro modelo", () => {
    const t = textoAvisoConfiguracion({ codigo: "modelo_efectivo_distinto", observados: ["modelo-a"], produccion: ["modelo-a", "modelo-a-nuevo"] });
    expect(t).toContain("El proveedor respondió con un modelo distinto al configurado");
    expect(t).toContain("«modelo-a-nuevo»");
    expect(t).toContain("«modelo-a»");
    expect(textoAvisoConfiguracion({ codigo: "modelo_efectivo_distinto", observados: [], produccion: ["x"] })).toContain("ninguno registrado");
  });

  it("una capacidad solo se habilita con una evaluación ganadora de la misma terna", () => {
    const terna = { proveedor: "openai", modelo: "modelo-a", version_prompt: "v1" };
    const evals = [evaluacion(), evaluacionNoGana({ modelo: "modelo-a" }), evaluacion({ id: "ev-3", modelo: "modelo-b" }), evaluacion({ id: "ev-4", estado: "cancelada", veredicto: null }), evaluacion({ id: "ev-5", proveedor: "anthropic" })];
    const elegibles = evaluacionesElegibles(evals, terna);
    expect(elegibles.map((e) => e.id)).toEqual(["ev-1"]);
    expect(capacidadHabilitable(elegibles, "ev-1")).toBe(true);
    expect(capacidadHabilitable(elegibles, "ev-3")).toBe(false);
    expect(capacidadHabilitable(elegibles, "")).toBe(false);
    expect(ETIQUETA_CAPACIDAD.distribucion_y1).toContain("distribucion_y1");
  });

  it("el estado de la clave nunca muestra su valor", () => {
    expect(textoClavePresente(servicio())).toBe("sí");
    expect(textoClavePresente(servicioApagado("sin_clave"))).toBe("no");
    expect(textoClavePresente(servicioApagado("clave_invalida"))).toContain("rechazó");
  });

  it("el prompt que se muestra es el fijo, sin datos", () => {
    expect(TEXTOS_PROMPT.v1).toContain("# Rol");
    expect(TEXTOS_PROMPT.v1).not.toMatch(/\b20(2[3-9]|3\d)\b/);
  });
});

describe("administración: evaluaciones", () => {
  it("el informe pone en tablas el reparto y el natural de cada pliegue, con el IC del bootstrap en D25", () => {
    const t = tablasInforme(resultados());
    expect(t.reparto.map((f) => f.pliegue)).toEqual(["D25", "D24"]);
    expect(t.reparto[0]).toMatchObject({ wape_metodo: "13.1 %", wape_tendencia: "12.4 %", wape_ia: "10.9 %", rival: "regla de tendencia", mejora: "+12.1 %", ic90: "[0.4; 3.1] pp" });
    expect(t.reparto[1].wape_tendencia).toBe("—");
    expect(t.natural[0].mejora).toBe("+12.5 %");
    expect(tablasInforme(resultados({ d24: null }))).toEqual({ reparto: [t.reparto[0]], natural: [t.natural[0]] });
    expect(textoIc90(null)).toBe("—");
  });

  it("cada regla que puede fallar tiene su texto", () => {
    for (const r of ["sin_dato", "mejora", "bootstrap", "mayoria_gm", "genero", "natural", "contraste_d24", "cobertura", "estabilidad"] as const) expect(textoReglaQueFallo(r)).not.toBe(r);
    expect(textoReglaQueFallo(null)).toBe("ninguna");
    expect(wapeTexto(0.0567)).toBe("5.7 %");
    expect(mejoraTexto(-0.05)).toBe("-5.0 %");
  });

  it("intento n.º y mejora mínima: 5 % la primera versión de prompt, 10 % desde la segunda", () => {
    expect(textoIntentoNuevo([], "v1")).toBe("intento n.º 1 · mejora mínima exigida 5 % (primera versión de prompt evaluada)");
    const previas = [evaluacion({ intento: 3 }), evaluacionNoGana({ intento: 4 })];
    expect(textoIntentoNuevo(previas, "v1")).toContain("intento n.º 5");
    expect(textoIntentoNuevo(previas, "v1")).toContain("5 %");
    expect(textoIntentoNuevo(previas, "v2")).toBe("intento n.º 5 · mejora mínima exigida 10 % (desde la segunda versión de prompt)");
    expect(versionesEvaluadasEnOrden([evaluacion({ version_prompt: "v2", iniciada_at: "2026-12-01T00:00:00Z" }), evaluacion({ version_prompt: "v1" })])).toEqual(["v1", "v2"]);
  });

  it("nueva evaluación: parte de la vigente, los pliegues por defecto y valida el tope", () => {
    const f = formEvaluacionInicial(configuracion(), ["modelo-a"], ["v1"]);
    expect(f.pliegues).toEqual(["D25", "E25", "D24"]);
    expect(f.tope_usd).toBe("50");
    const ctx = { modelosPermitidos: ["modelo-a"], prompts: ["v1"] };
    const ok = validarEvaluacion(f, ctx);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.cuerpo).toMatchObject({ modelo: "modelo-a", pliegues: ["D25", "E25", "D24"], tope_usd: 50, precios: { entrada: 1.5, entrada_cache: 0.75, salida: 6 } });
    expect(validarEvaluacion({ ...f, pliegues: [] }, ctx).ok).toBe(false);
    expect(validarEvaluacion({ ...f, tope_usd: "501" }, ctx).ok).toBe(false);
    expect(validarEvaluacion({ ...f, modelo: "otro" }, ctx).ok).toBe(false);
  });

  it("duración, mes y día", () => {
    expect(duracionTexto("2026-11-02T13:00:00Z", "2026-11-02T13:47:00Z")).toBe("47 min");
    expect(duracionTexto("2026-11-02T13:00:00Z", "2026-11-02T14:05:00Z")).toBe("1 h 05 min");
    expect(duracionTexto("2026-11-02T13:00:00Z", null)).toBe("—");
    expect(nombreMes("2026-11")).toBe("noviembre de 2026");
    expect(diaCorto("2026-11-02")).toBe("02/11");
  });
});
