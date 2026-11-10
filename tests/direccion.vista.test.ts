import { describe, expect, it } from "vitest";
import { fechaCorta, fechaHora, MENOS, mesAnio, mesesCobertura, participacion, porcentaje, puntos, rangoMeses, soles, textoEstadoDireccion, unidades, unidadesConSigno } from "../src/components/direccion/formato";
import { textoDiferenciaAprobada, tonoAviso, urlEstadoDireccion, vistaAvisoDireccion } from "../src/components/direccion/vista-aviso";
import { aprobarDireccionSchema, tableroQuerySchema } from "../src/lib/direccion/esquemas";
import { HOJAS_DIRECCION, tipoMensual } from "../src/lib/direccion/excel";
import {
  acumularSeries,
  admiteLinea,
  alertasDe,
  aplicarCambio,
  AYUDA_PUENTE,
  ayudaFilaDesglose,
  cambioPorFilaDesglose,
  clavesPorDefecto,
  columnasDesglose,
  consultaPagina,
  consultaTablero,
  cuentaFiltros,
  cuerpoDecision,
  datosCobertura,
  descripcionGrafico,
  esEnlaceInterno,
  esFilaCierre,
  filasHistorial,
  filasMayores,
  filasPuente,
  filasSoles,
  filasTablaMensual,
  FILTROS_VACIOS,
  filtrosVistos,
  gruposDeTiendas,
  hojasTablero,
  largoComentario,
  lecturaDelMes,
  leerFiltrosUrl,
  limpiarRecorte,
  lineaResumenBloqueos,
  lineasResumen,
  mismasSobreCorregido,
  motivoNoEnviar,
  nombreArchivoDireccion,
  notaTablaMensual,
  notasAtribucion,
  ordenarDesglose,
  pctMismasCorregido,
  puenteEnLinea,
  puenteTotal,
  recorteVacio,
  seriesGrafico,
  tablaPuenteGm,
  tarjetas,
  textoCabecera,
  textoComparando,
  textoCompararPorDefecto,
  textoDatosMasNuevos,
  textoDeclarado,
  textoImplicito,
  textoRecorte,
  textoSemaforo,
  textoTendencia,
  textoVersion,
  totalDesgloseCuadra,
  urlAprobaciones,
  urlBloqueos,
  urlTablero,
  vistaBloqueos,
  vistaDecisiones,
  vistaDiferencia,
  type FiltrosVista,
} from "../src/app/(app)/planificacion/aprobacion-direccion/vista-tablero";
import {
  ADVERTENCIA_MARCA,
  aprobacion,
  bloqueos,
  bloqueosNinguno,
  bloqueosSoloDesactualizada,
  crecimientos,
  desgloseMarca,
  diferencia,
  estadoDireccion,
  GM_HU,
  historial,
  HUELLA,
  ID,
  LINEAS_DECIDIR,
  M2026_REAL,
  NOTA_SIN_ATRIBUIR,
  opciones,
  proyeccion,
  proyeccionEnTrabajo,
  puenteHU,
  tablero,
  tableroConMarca,
  tableroConTienda,
  tableroEnTrabajo,
} from "./direccion.pantalla.fixture";

const params = (q: string) => new URLSearchParams(q);
const filtros = (extra: Partial<FiltrosVista> = {}): FiltrosVista => ({ ...FILTROS_VACIOS, ...extra });
const comoObjeto = (q: string) => Object.fromEntries(new URLSearchParams(q));

describe("formatos es-PE (miles con coma, decimal con punto, mes «set»)", () => {
  it("unidades, signos, porcentajes, puntos y participaciones", () => {
    expect(unidades(52708)).toBe("52,708");
    expect(unidades(null)).toBe("—");
    expect(unidadesConSigno(1408)).toBe("+1,408");
    expect(unidadesConSigno(-2961)).toBe("−2,961");
    expect(unidadesConSigno(0)).toBe("0");
    expect(porcentaje(7.94)).toBe("+7.9 %");
    expect(porcentaje(-3.94)).toBe("−3.9 %");
    expect(porcentaje(0.01)).toBe("0.0 %");
    expect(porcentaje(null)).toBe("—");
    expect(puntos(4.3)).toBe("+4.3 pp");
    expect(participacion(0.157)).toBe("15.7 %");
  });

  it("meses y fechas en hora de Lima", () => {
    expect(mesAnio("2026-09")).toBe("set 2026");
    expect(mesAnio("2026-09-01")).toBe("set 2026");
    expect(rangoMeses(1, 9)).toBe("ene–set");
    expect(rangoMeses(10, 12)).toBe("oct–dic");
    expect(fechaCorta("2026-11-07")).toBe("07 nov 2026");
    // 02:30 UTC del 8 es todavía el 7 en Lima.
    expect(fechaCorta("2026-11-08T02:30:00Z")).toBe("07 nov 2026");
    expect(fechaHora("2026-11-08T15:30:00Z")).toBe("08 nov 2026, 10:30");
  });
});

describe("filtros: URL de la página ↔ query de la API (un solo lugar)", () => {
  const url = `proyeccion=${ID.proyeccion}&comparar=ninguna&generos=${ID.hombre}&mundo=${ID.urbano}&linea=${ID.l1}&temporadas=invierno,todo_el_ano&am=${ID.amA},${ID.amB}&marca=${ID.marcaX}&tiendas=${ID.t03}&bloque=mismas&desglose=linea`;

  it("lee los nombres cortos de §4.7 y vuelve a escribirlos igual", () => {
    const f = leerFiltrosUrl(params(url));
    expect(f).toEqual({
      proyeccion: ID.proyeccion,
      comparar: "ninguna",
      generos: [ID.hombre],
      resto: false,
      mundo: ID.urbano,
      linea: ID.l1,
      temporadas: ["invierno", "todo_el_ano"],
      am: [ID.amA, ID.amB],
      marca: ID.marcaX,
      tiendas: [ID.t03],
      bloque: "mismas",
      desglose: "linea",
    });
    expect(comoObjeto(consultaPagina(f))).toEqual(comoObjeto(url));
  });

  it("traduce a los nombres de la API y la query pasa el esquema real del servidor (que rechaza parámetros desconocidos)", () => {
    const q = comoObjeto(consultaTablero(leerFiltrosUrl(params(url))));
    expect(Object.keys(q).sort()).toEqual(["am", "bloque", "comparar_id", "desglose", "generos", "linea_id", "marca", "mundo_id", "proyeccion_id", "temporadas", "tiendas"]);
    expect(q.proyeccion_id).toBe(ID.proyeccion);
    expect(q.comparar_id).toBe("ninguna");
    expect(q.mundo_id).toBe(ID.urbano);
    expect(q.linea_id).toBe(ID.l1);
    const r = tableroQuerySchema.safeParse(q);
    expect(r.success).toBe(true);
    // Los nombres de la página NO son los de la API: mandarlos tal cual daría 400.
    expect(tableroQuerySchema.safeParse(comoObjeto(url)).success).toBe(false);
  });

  it("sin filtros no manda nada: el servidor abre la proyección por defecto y compara con la última aprobada", () => {
    expect(consultaTablero(FILTROS_VACIOS)).toBe("");
    expect(urlTablero(FILTROS_VACIOS)).toBe("/api/direccion/tablero");
    expect(tableroQuerySchema.safeParse({}).success).toBe(true);
    expect(urlBloqueos(ID.proyeccion)).toBe(`/api/direccion/bloqueos?proyeccion_id=${ID.proyeccion}`);
    expect(urlAprobaciones(ID.proyeccion)).toBe(`/api/direccion/aprobaciones?proyeccion_id=${ID.proyeccion}`);
  });

  it("«resto=1» y varios géneros; lo que no se entiende se ignora", () => {
    const f = leerFiltrosUrl(params(`generos=${ID.hombre},${ID.mujer},nada&resto=1&bloque=raro&desglose=otro&temporadas=invierno,primavera&mundo=x&extra=1`));
    expect(f.generos).toEqual([ID.hombre, ID.mujer]);
    expect(f.resto).toBe(true);
    expect(f.bloque).toBe("todas");
    expect(f.desglose).toBe("mundo");
    expect(f.temporadas).toEqual(["invierno"]);
    expect(f.mundo).toBeNull();
    const q = comoObjeto(consultaTablero(f));
    expect(q).toEqual({ generos: `${ID.hombre},${ID.mujer}`, resto: "1", temporadas: "invierno" });
    expect(tableroQuerySchema.safeParse(q).success).toBe(true);
  });

  it("la línea exige un solo género (sin Resto) y un mundo; no se compara una proyección consigo misma", () => {
    expect(admiteLinea(filtros({ generos: [ID.hombre], mundo: ID.urbano }))).toBe(true);
    expect(admiteLinea(filtros({ generos: [ID.hombre, ID.mujer], mundo: ID.urbano }))).toBe(false);
    expect(admiteLinea(filtros({ generos: [ID.hombre], resto: true, mundo: ID.urbano }))).toBe(false);
    expect(leerFiltrosUrl(params(`generos=${ID.hombre},${ID.mujer}&mundo=${ID.urbano}&linea=${ID.l1}`)).linea).toBeNull();
    expect(leerFiltrosUrl(params(`generos=${ID.hombre}&linea=${ID.l1}`)).linea).toBeNull();
    expect(leerFiltrosUrl(params(`proyeccion=${ID.proyeccion}&comparar=${ID.proyeccion}`)).comparar).toBeNull();
  });

  it("aplicar un cambio deja los filtros coherentes con las reglas de la API", () => {
    const o = opciones();
    const base = filtros({ generos: [ID.hombre], mundo: ID.urbano, linea: ID.l1 });
    // Otro género suelta la línea; otro mundo, también.
    expect(aplicarCambio(base, { generos: [ID.hombre, ID.mujer] }, o).linea).toBeNull();
    expect(aplicarCambio(base, { mundo: ID.formal }, o).linea).toBeNull();
    expect(aplicarCambio(base, { generos: [ID.mujer] }, o).linea).toBeNull();
    // «Resto» quita sus géneros de la lista y la línea.
    const conResto = aplicarCambio(filtros({ generos: [ID.hombre, ID.ninos], mundo: ID.urbano }), { resto: true }, o);
    expect(conResto.generos).toEqual([ID.hombre]);
    expect(conResto.resto).toBe(true);
    // Marca de otra agrupación: al elegir la marca se sueltan las agrupaciones; al cambiar las agrupaciones se suelta la marca.
    expect(aplicarCambio(filtros({ am: [ID.amB] }), { marca: ID.marcaX }, o)).toMatchObject({ am: [], marca: ID.marcaX });
    expect(aplicarCambio(filtros({ am: [ID.amA], marca: ID.marcaX }), { am: [ID.amB] }, o)).toMatchObject({ am: [ID.amB], marca: null });
    expect(aplicarCambio(filtros({ am: [ID.amA] }), { marca: ID.marcaX }, o)).toMatchObject({ am: [ID.amA], marca: ID.marcaX });
    // Cambiar a la proyección con la que se comparaba deja de comparar con ella.
    expect(aplicarCambio(filtros({ comparar: ID.seguimiento }), { proyeccion: ID.seguimiento }, o).comparar).toBeNull();
  });

  it("cuenta los filtros del recorte, los limpia conservando proyección, comparada y desglose, y arma `filtros_vistos`", () => {
    const f = filtros({ proyeccion: ID.proyeccion, comparar: "ninguna", desglose: "tienda", generos: [ID.hombre], resto: true, mundo: ID.urbano, temporadas: ["invierno"], am: [ID.amA], tiendas: [ID.t03], bloque: "mismas" });
    expect(cuentaFiltros(f)).toBe(7);
    expect(cuentaFiltros(FILTROS_VACIOS)).toBe(0);
    expect(limpiarRecorte(f)).toEqual({ ...FILTROS_VACIOS, proyeccion: ID.proyeccion, comparar: "ninguna", desglose: "tienda" });
    expect(filtrosVistos(f)).toEqual({ generos: [ID.hombre], resto: true, mundo_id: ID.urbano, linea_id: null, temporadas: ["invierno"], am: [ID.amA], marca: null, tiendas: [ID.t03], bloque: "mismas" });
  });

  it("las tiendas del filtro se agrupan por su situación en el año siguiente, con los años de la respuesta", () => {
    const t = tablero();
    const grupos = gruposDeTiendas(opciones().tiendas, t.datos.tiendas, t.proyeccion);
    expect(grupos.map((g) => g.titulo)).toEqual(["Mismas tiendas 2027", "Aperturas 2027", "Cierres 2027", "Cerradas o fuera de la proyección"]);
    expect(grupos[0].items.map((i) => i.label)).toEqual(["T01 · Tienda T01", "T02 · Tienda T02", "T03 · Tienda T03", "T10 · Tienda T10"]);
    expect(gruposDeTiendas(opciones().tiendas, null, null).map((g) => g.titulo)).toEqual(["Tiendas"]);
  });
});

describe("cabecera y estado de dirección en texto", () => {
  it("dice cuál proyección, quién la cerró y cuándo, hasta qué mes y si la usa Compras", () => {
    expect(textoCabecera(proyeccion())).toBe("Proyección 2026–2027 · cerrada el 07 nov 2026 por Planner P. · datos hasta set 2026 · la que usa Compras");
    expect(textoCabecera(proyeccionEnTrabajo())).toBe("Proyección 2026–2027 seguimiento oct · en trabajo · datos hasta set 2026");
  });

  it("el estado se lee sin colores", () => {
    const a = aprobacion();
    expect(textoEstadoDireccion("sin_aprobacion", null)).toBe("Sin aprobación de dirección");
    expect(textoEstadoDireccion("aprobada", a)).toBe("Aprobada por Admin A. el 08 nov 2026");
    expect(textoEstadoDireccion("con_observaciones", a)).toBe("Aprobada con observaciones por Admin A. el 08 nov 2026");
    expect(textoEstadoDireccion("rechazada", a)).toBe("Rechazada por Admin A. el 08 nov 2026");
    expect(textoEstadoDireccion("invalidada", { ...a, invalidada_por: "cifras" })).toBe("Aprobación invalidada: la proyección cambió después del 08 nov 2026");
    expect(textoEstadoDireccion("invalidada", { ...a, invalidada_por: "version_huella" })).toBe("Aprobación invalidada por un cambio en el cálculo de la huella");
  });

  it("avisa si hay venta publicada más nueva que los datos de la proyección", () => {
    expect(textoDatosMasNuevos(tablero())).toBe("Hay venta publicada hasta oct 2026; esta proyección se calculó con datos hasta set 2026.");
    const t = tablero();
    expect(textoDatosMasNuevos({ ...t, datos: { ...t.datos, k_prima: 9, ultimo_publicado: "2026-09" } })).toBeNull();
  });

  it("el recorte en texto incluye el conjunto de tiendas de las líneas", () => {
    expect(textoRecorte(tablero().filtros)).toEqual(["HOMBRE · URBANO"]);
    expect(textoRecorte(tableroConTienda().filtros)).toEqual(["HOMBRE · URBANO · tiendas: T03 · cifras de T03 estimadas", "Mismas tiendas de 2027 (1): T03"]);
  });
});

describe("lo que bloquearía el cierre (de /bloqueos, aparte del tablero)", () => {
  it("cerrada o archivada: no aplica; en trabajo y sin respuesta: comprobando", () => {
    expect(vistaBloqueos({ enTrabajo: false, datos: null, cargando: false, error: null })).toEqual({ estado: "no_aplica" });
    expect(vistaBloqueos({ enTrabajo: true, datos: null, cargando: true, error: null })).toEqual({ estado: "cargando" });
    expect(vistaBloqueos({ enTrabajo: true, datos: null, cargando: false, error: "Falló" })).toEqual({ estado: "error", mensaje: "Falló" });
    expect(vistaBloqueos({ enTrabajo: true, datos: { aplica: false }, cargando: false, error: null })).toEqual({ estado: "no_aplica" });
  });

  it("las causas van con su código y su mensaje tal cual; la forzable, aparte; las filas, con su conteo por año", () => {
    const v = vistaBloqueos({ enTrabajo: true, datos: bloqueos(), cargando: false, error: null });
    if (v.estado !== "listo") throw new Error("se esperaba listo");
    expect(v.duros.map((d) => d.codigo)).toEqual(["crecimientos_cambiados", "filas_sin_decidir"]);
    expect(v.duros[0].mensaje).toBe("Los crecimientos aprobados cambiaron después de calcular: recalcúlala antes de cerrar.");
    expect(v.duros[1].detalles).toEqual(["2027: 37 filas sin decidir, 41,200 u; 12 de ellas de cola larga para revisión"]);
    expect(v.forzables.map((d) => d.codigo)).toEqual(["desactualizada"]);
    expect(v.forzables[0].detalles).toEqual(["Se publicó 2026-10 en M5."]);
    expect(v.titulo).toBe("2 causas bloquearían el cierre");
    expect(lineaResumenBloqueos(v)).toBe("En trabajo; 2 causas bloquearían el cierre");
  });

  it("solo desactualizada: se puede cerrar igual; sin causas: nada bloquea", () => {
    const solo = vistaBloqueos({ enTrabajo: true, datos: bloqueosSoloDesactualizada(), cargando: false, error: null });
    expect(solo).toMatchObject({ estado: "listo", titulo: "Nada bloquea el cierre; está desactualizada" });
    expect(lineaResumenBloqueos(solo)).toBe("En trabajo; está desactualizada, pero se puede cerrar igual");
    const nada = vistaBloqueos({ enTrabajo: true, datos: bloqueosNinguno(), cargando: false, error: null });
    expect(nada).toMatchObject({ estado: "listo", titulo: "Nada bloquea el cierre" });
    expect(lineaResumenBloqueos(nada)).toBe("En trabajo; nada bloquea el cierre");
    expect(lineaResumenBloqueos({ estado: "cargando" })).toBe("En trabajo; comprobando qué bloquearía el cierre…");
    expect(lineaResumenBloqueos({ estado: "no_aplica" })).toBeNull();
  });

  it("las alertas se separan por alcance y por nivel, en el orden del servidor", () => {
    const p = alertasDe(tablero().alertas, "proyeccion");
    expect(p.importantes.map((a) => a.codigo)).toEqual(["contra_tendencia", "desvio_crecimiento", "factor_provisional", "tienda_nueva_relevante", "apertura_sin_historia"]);
    expect(p.informativas).toHaveLength(5);
    expect(alertasDe(tablero().alertas, "recorte").importantes).toHaveLength(1);
  });
});

describe("puente de 2026 a 2027", () => {
  it("el total parte del cierre y llega exacto al año siguiente; cada paso con unidades, acumulado y %", () => {
    const total = puenteTotal(tablero());
    expect(total?.gm_clave).toBe("total");
    const filas = filasPuente(total!, { hayCierres: true });
    const de = (clave: string) => filas.find((f) => f.clave === clave)!;
    expect(de("cierre_en_curso")).toMatchObject({ unidades: "", acumulado: "78,501", subtotal: true });
    expect(de("ajuste_base")).toMatchObject({ unidades: "−2,961", acumulado: "75,540", pct: "−3.8 %", diferencia: false });
    expect(de("base")).toMatchObject({ acumulado: "75,540", subtotal: true });
    expect(de("nino")).toMatchObject({ unidades: "+753", acumulado: "76,293", pct: "+1.0 %" });
    expect(de("crecimiento")).toMatchObject({ unidades: "+4,670", acumulado: "80,963" });
    expect(de("manual")).toMatchObject({ unidades: "+1,343", acumulado: "82,306" });
    expect(de("otras")).toMatchObject({ unidades: "0", acumulado: "82,306" });
    expect(de("mismas_siguiente")).toMatchObject({ acumulado: "82,306", subtotal: true });
    expect(de("aperturas")).toMatchObject({ unidades: "+1,408", acumulado: "83,714" });
    expect(de("cierres")).toMatchObject({ unidades: "+1,000", acumulado: "84,714" });
    expect(de("total_siguiente")).toMatchObject({ acumulado: "84,714", pct: "+7.9 % vs cierre", subtotal: true });
  });

  it("el rótulo y la ayuda de cada paso son los del servidor, tal cual; si no trae ayuda, la de la pantalla", () => {
    const filas = filasPuente(puenteHU());
    expect(filas.find((f) => f.clave === "manual")).toMatchObject({ etiqueta: "+ Cifras fijadas (a mano o sugeridas por IA)", ayuda: "Lo que el planner o el admin fijaron por encima o por debajo de la propuesta, a mano o aceptando una cifra sugerida por la IA." });
    expect(filas.find((f) => f.clave === "otras")).toMatchObject({ etiqueta: "+ Otras diferencias con la propuesta", ayuda: "Filas aceptadas en bloque, por IA o tal cual cuya propuesta cambió después al recalcular, y filas escaladas por tienda." });
    expect(filas.find((f) => f.clave === "base")).toMatchObject({ etiqueta: "Base 2027 (B): 2026 de las mismas tiendas de 2027", ayuda: AYUDA_PUENTE.base, pct: "−5.9 % vs cierre" });
    // Si el servidor cambia el rótulo (p. ej. «Fijado a mano»), la pantalla pinta ese.
    const otro = { ...puenteHU(), lineas: puenteHU().lineas.map((l) => (l.clave === "manual" ? { ...l, etiqueta: "+ Fijado a mano", ayuda: undefined } : l)) };
    expect(filasPuente(otro).find((f) => f.clave === "manual")).toMatchObject({ etiqueta: "+ Fijado a mano", ayuda: AYUDA_PUENTE.manual });
    expect(AYUDA_PUENTE.otras).toContain("cuya propuesta cambió después al recalcular");
    for (const f of filas) expect(f.ayuda.length).toBeGreaterThan(20);
  });

  it("sin tiendas que salgan, una línea de ajuste distinta de cero se marca «diferencia»; sin base corregida, el Niño sale «—»", () => {
    expect(filasPuente(puenteHU(), { hayCierres: false }).find((f) => f.clave === "ajuste_base")?.diferencia).toBe(true);
    const sinNino = { ...puenteHU(), pct: { ...puenteHU().pct, nino: null } };
    sinNino.lineas = sinNino.lineas.map((l) => (l.clave === "nino" ? { ...l, u: 0 } : l));
    expect(filasPuente(sinNino).find((f) => f.clave === "nino")?.unidades).toBe("—");
  });

  it("el puente del recorte se lee en una línea", () => {
    expect(puenteEnLinea(puenteHU())).toBe("Base 47,040 → Niño +753 → crecimiento +2,390 → fijadas +117 → mismas 50,300 → aperturas +1,408 → cierres +1,000 → 52,708");
  });

  it("por género × mundo: las mismas columnas, una fila por GM, el Resto y el Total; los GM con Niño lo dicen", () => {
    const t = tablero();
    const tabla = tablaPuenteGm(t.puente.por_gm, t.crecimientos, t.proyeccion);
    expect(tabla.columnas.map((c) => c.titulo)).toEqual(["2026 cierre", "− fuera de la base", "− salen de la base", "Base 2027", "+ Niño", "+ crecimiento", "+ fijadas", "+ otras", "+ sin base", "Mismas 2027", "+ abiertas 2026", "+ aperturas 2027", "+ cierran 2027", "2027"]);
    expect(tabla.filas.map((f) => f.nombre)).toEqual(["HOMBRE · URBANO", "MUJER · URBANO", "Resto", "Total"]);
    const hu = tabla.filas[0];
    expect(hu.nino).toBe(true);
    expect(hu.celdas).toEqual(["50,001", "0", "−2,961", "47,040", "+753", "+2,390", "+117", "0", "0", "50,300", "0", "+1,408", "+1,000", "52,708"]);
    expect(tabla.filas[1].nino).toBe(false);
    expect(tabla.filas[1].celdas[4]).toBe("—");
    expect(tabla.filas[3]).toMatchObject({ total: true });
    expect(tabla.filas[3].celdas.at(-1)).toBe("84,714");
  });
});

describe("frente a lo aprobado", () => {
  const p = proyeccion();
  it("tabla por GM ordenada por diferencia, con el total y el cierre", () => {
    const v = vistaDiferencia(diferencia(), p);
    if (v.tipo !== "tabla") throw new Error("se esperaba tabla");
    expect(v.encabezado).toBe("Aprobada el 03 nov 2026 por Admin A. en Proyección 2026–2027 seguimiento set.");
    expect(v.filas.map((f) => [f.nombre, f.aprobado, f.actual, f.diferencia, f.pct])).toEqual([
      ["MUJER · URBANO", "31,000", "32,006", "+1,006", "+3.2 %"],
      ["HOMBRE · URBANO", "52,500", "52,708", "+208", "+0.4 %"],
      ["Total 2027", "83,500", "84,714", "+1,214", "+1.5 %"],
      ["2026 cierre", "78,300", "78,501", "+201", "+0.3 %"],
    ]);
  });

  it("los tres casos sin tabla", () => {
    expect(vistaDiferencia(null, p)).toEqual({ tipo: "sin_aprobadas", texto: "Todavía no hay ninguna proyección aprobada." });
    expect(vistaDiferencia({ ...diferencia(), identica: true, misma_proyeccion: true }, p)).toEqual({ tipo: "oculta" });
    expect(vistaDiferencia({ ...diferencia(), identica: true }, p)).toEqual({ tipo: "identica", texto: "Idéntica a lo aprobado el 03 nov 2026 en Proyección 2026–2027 seguimiento set; esta copia aún no tiene aprobación propia." });
  });
});

describe("cifras del recorte (tarjetas)", () => {
  it("las cuatro tarjetas del caso HOMBRE · URBANO", () => {
    const [sig, cierre, enCurso, mismas] = tarjetas(tablero());
    expect(sig).toMatchObject({ titulo: "2027 proyectado", valor: "52,708 u", estimado: false, nino: false });
    expect(sig.lineas.map((l) => l.texto)).toEqual(["+5.4 % vs cierre 2026", "+12.1 % vs 2025, último año normal"]);
    expect(sig.lineas[1].fuerte).toBe(true);
    expect(cierre).toMatchObject({ titulo: "2026 cierre", valor: "50,001 u", nino: true });
    expect(cierre.lineas.map((l) => l.texto)).toEqual(["= real ene–set 34,000 + proyectado oct–dic 16,001", "+6.4 % vs 2025", "+19.0 % vs 2024", "año del Niño"]);
    expect(enCurso).toMatchObject({ titulo: "2026 en lo que va (ene–oct)", valor: "38,300 u" });
    expect(enCurso.lineas.map((l) => l.texto)).toEqual(["+3.0 % · 2026 ene–set vs 2025 ene–set"]);
    expect(mismas).toMatchObject({ titulo: "Mismas tiendas", valor: "+6.9 %" });
    expect(mismas.lineas.map((l) => l.texto)).toEqual(["2027 vs 2026: +6.9 % sobre real, +5.2 % sobre corregido (4 tiendas)", "total con nuevas, aperturas y cierres +5.4 %", "2026 vs 2025: −1.7 % (4 tiendas)"]);
  });

  it("el % sobre corregido sale del puente del recorte y no se inventa sin él", () => {
    expect(mismasSobreCorregido(puenteHU())).toBeCloseTo((50300 / 47793 - 1) * 100, 6);
    expect(mismasSobreCorregido(null)).toBeNull();
    expect(mismasSobreCorregido({ ...puenteHU(), pct: { ...puenteHU().pct, nino: null } })).toBeNull();
  });

  it("con una tienda elegida todo va «estimado», no hay puente del recorte y la participación usada queda escrita", () => {
    const t = tableroConTienda();
    const [sig, , , mismas] = tarjetas(t);
    expect(sig).toMatchObject({ valor: "7,917 u", estimado: true });
    expect(mismas.lineas[0].texto).not.toContain("sobre corregido");
    expect(notasAtribucion(t)).toEqual([
      "T03: 2027 estimado con su parte de la base 2026 (15.7 %) y, mes a mes, con su participación de cada mes del año de referencia (de 11.5 % en enero a 22.8 % en junio).",
      "Sin atribuir en 2027: −12 u: lo atribuido a las tiendas supera lo proyectado para el bloque (la base anual y la curva guardada difieren; ver la línea «diferencia» del puente). Nunca se resta de una tienda.",
    ]);
    expect(notasAtribucion(tablero())).toEqual([]);
  });

  it("un recorte sin venta ni proyección se reconoce como vacío", () => {
    expect(recorteVacio(tablero())).toBe(false);
    const t = tablero();
    expect(recorteVacio({ ...t, kpis: { ...t.kpis, siguiente: 0, cierre: 0, real_ac: 0, proyectado_resto: 0, anterior: 0, hace_dos: 0, hace_tres: 0 } })).toBe(true);
  });
});

describe("gráfico mensual", () => {
  const series = seriesGrafico(tablero());
  const de = (clave: string) => series.find((s) => s.clave === clave)!;

  it("las series se distinguen por trazo y grosor, no solo por color; los años del Niño salen de la respuesta y van rotulados", () => {
    expect(de("real-2023")).toMatchObject({ etiqueta: "2023 (Niño)", grosor: 1.5, dash: "9 3 2 3" });
    expect(de("real-2024")).toMatchObject({ etiqueta: "2024", grosor: 1.5 });
    expect(de("real-2024").dash).toBeUndefined();
    expect(de("real-2026")).toMatchObject({ etiqueta: "2026 real (Niño)", grosor: 3 });
    expect(de("real-2026").dash).toBeUndefined();
    expect(de("proyectado-2026")).toMatchObject({ grosor: 3, dash: "7 5" });
    expect(de("proyectado-2027")).toMatchObject({ etiqueta: "2027 proyectado", grosor: 4, dash: "7 5" });
    expect(de("sin-nino-2026")).toMatchObject({ etiqueta: "2026 sin Niño (derivado)", grosor: 1.5, dash: "3 4" });
    expect(de("sin-nino-2026").ayuda).toBe("2026 dividido por el factor del Niño de cada mes, para ver qué parte del salto de 2027 es corrección.");
    expect(de("comparada")).toMatchObject({ etiqueta: "Proyección 2026–2027 seguimiento set (aprobada)", dash: "1 5" });
    // Ninguna pareja comparte trazo y grosor a la vez.
    const firmas = series.map((s) => `${s.dash ?? "continuo"}|${s.grosor}`);
    expect(new Set(firmas).size).toBe(new Set(series.map((s) => `${s.tipo}|${s.nino && s.tipo === "real"}|${s.anio >= 2027 && s.tipo === "proyectado"}`)).size);
  });

  it("con otros años del Niño en la respuesta, el rótulo cambia (no va fijo)", () => {
    const t = tablero();
    const otras = seriesGrafico({ ...t, series: t.series.map((s) => ({ ...s, nino: s.anio === 2024 })) });
    expect(otras.find((s) => s.clave === "real-2024")?.etiqueta).toBe("2024 (Niño)");
    expect(otras.find((s) => s.clave === "real-2023")?.etiqueta).toBe("2023");
  });

  it("por defecto: en pantalla angosta los años más viejos van apagados; en ancha, todas", () => {
    expect(clavesPorDefecto(series, false)).toEqual(["real-2025", "real-2026", "proyectado-2026", "sin-nino-2026", "proyectado-2027", "comparada"]);
    expect(clavesPorDefecto(series, true)).toHaveLength(8);
  });

  it("acumulado: lo proyectado del año en curso arranca desde lo real acumulado hasta `k`", () => {
    const ac = acumularSeries(series);
    const real = ac.find((s) => s.clave === "real-2026")!;
    const proy = ac.find((s) => s.clave === "proyectado-2026")!;
    expect(real.valores[8]).toBe(34000);
    expect(real.valores[9]).toBe(38300);
    expect(real.valores[10]).toBeNull();
    expect(proy.valores[8]).toBeNull();
    expect(proy.valores[9]).toBe(37900);
    expect(proy.valores[11]).toBe(50001);
    expect(ac.find((s) => s.clave === "proyectado-2027")!.valores[11]).toBe(52708);
  });

  it("la lectura de octubre da el real y el proyectado a la vez, con su diferencia (no se suman dos veces)", () => {
    const texto = lecturaDelMes(10, series.filter((s) => ["real-2026", "proyectado-2026", "proyectado-2027"].includes(s.clave)));
    expect(texto).toBe("oct · 2026 real (Niño): 4,300 · 2026 proyectado (Niño): 3,900 · 2027 proyectado: 4,194 · real − proyectado de 2026: +400");
    expect(lecturaDelMes(11, [de("real-2026")])).toBe("nov: sin dato");
  });

  it("el pie del gráfico en texto", () => {
    expect(descripcionGrafico(tablero())).toBe("2027 proyecta 52,708 u, +5.4 % sobre el cierre 2026; el mes mayor es diciembre.");
    expect(descripcionGrafico(tableroConTienda())).toContain("2027 proyecta 7,917 u (estimado)");
    expect(seriesGrafico(tableroConTienda()).find((s) => s.clave === "proyectado-2027")?.etiqueta).toBe("2027 proyectado (estimado)");
  });
});

describe("tabla mensual", () => {
  const filas = filasTablaMensual(tablero());
  const de = (clave: string) => filas.find((f) => f.clave === clave)!;

  it("real en redonda, proyectado marcado, años del Niño rotulados y meses sin dato con «—»", () => {
    expect(de("real-2023").etiqueta).toBe("2023 (Niño)");
    expect(de("real-2024").etiqueta).toBe("2024");
    expect(de("real-2026")).toMatchObject({ etiqueta: "2026 real (Niño)", proyectado: false, total: "38,300", acumulado: "38,300" });
    expect(de("real-2026").celdas.slice(9)).toEqual(["4,300", "—", "—"]);
    expect(de("proyectado-2026")).toMatchObject({ proyectado: true, total: "16,001", acumulado: "—" });
    expect(de("cierre-2026")).toMatchObject({ etiqueta: "2026 cierre (Niño)", total: "50,001" });
    expect(de("sin-nino-2026").etiqueta).toBe("2026 sin Niño");
    expect(de("proyectado-2027")).toMatchObject({ etiqueta: "2027", proyectado: true, total: "52,708", estimado: false });
    expect(de("proyectado-2027").celdas[11]).toBe("8,044");
  });

  it("el total de cada fila cuadra con las tarjetas y las variaciones van en %", () => {
    expect(de("real-2025").total).toBe("47,000");
    expect(de("real-2025").acumulado).toBe("36,455");
    expect(de("var-sig-cierre")).toMatchObject({ variacion: true, total: "+5.4 %", acumulado: "—" });
    expect(de("var-sig-anterior").total).toBe("+12.1 %");
    expect(de("var-cierre-anterior").total).toBe("+6.4 %");
  });

  it("«Sin atribuir» por mes se muestra con su signo", () => {
    const f = filasTablaMensual(tableroConTienda()).find((x) => x.clave === "sin-atribuir-2027")!;
    expect(f.celdas[9]).toBe("−12");
    expect(f.total).toBe("−12");
    expect(filasTablaMensual(tableroConTienda())[0].estimado).toBe(true);
  });
});

describe("desglose", () => {
  const t = tablero();
  it("columnas en el orden de la ficha, con los años de la respuesta", () => {
    const cols = columnasDesglose(t.desglose.total, t);
    expect(cols.map((c) => c.titulo)).toEqual(["2023 (Niño)", "2024", "2025", "2025 ene–oct", "2026 ene–oct", "2026 cierre (Niño)", "2027", "% 27/26", "% 27/25", "% 26/25", "% ene–oct", "part. 2027"]);
    expect(cols.map((c) => c.valor(t.desglose.total))).toEqual(["40,000", "42,000", "47,000", "36,455", "38,300", "50,001", "52,708", "+5.4 %", "+12.1 %", "+6.4 %", "+5.1 %", "100.0 %"]);
  });

  it("ordena por lo proyectado del año siguiente y el total es la suma de las filas", () => {
    const ordenadas = ordenarDesglose(t.desglose.filas, 2027);
    expect(ordenadas.map((f) => f.nombre)).toEqual(["L1 POLOS", "L2 CASACAS"]);
    for (const anio of [2023, 2024, 2025, 2026, 2027]) {
      const sumaFilas = t.desglose.filas.reduce((a, f) => a + (f.anios.find((x) => x.anio === anio)?.total ?? 0), 0);
      expect(sumaFilas).toBe(t.desglose.total.anios.find((x) => x.anio === anio)?.total);
    }
    expect(t.desglose.total.anios.find((x) => x.anio === 2027)?.total).toBe(t.kpis.siguiente);
  });

  it("elegir una fila la aplica como filtro", () => {
    const o = opciones();
    const f = { id: ID.l1, filtrable: true };
    expect(cambioPorFilaDesglose("linea", f, o)).toEqual({ generos: [ID.hombre], resto: false, mundo: ID.urbano, linea: ID.l1 });
    expect(cambioPorFilaDesglose("linea", { id: "desconocida", filtrable: true }, o)).toBeNull();
    expect(cambioPorFilaDesglose("genero", { id: ID.mujer, filtrable: true }, o)).toEqual({ generos: [ID.mujer], resto: false });
    expect(cambioPorFilaDesglose("mundo", { id: ID.urbano, filtrable: true }, o)).toEqual({ mundo: ID.urbano });
    expect(cambioPorFilaDesglose("agrupacion_marca", { id: ID.amA, filtrable: true }, o)).toEqual({ am: [ID.amA] });
    expect(cambioPorFilaDesglose("marca", { id: ID.marcaX, filtrable: true }, o)).toEqual({ marca: ID.marcaX });
    expect(cambioPorFilaDesglose("temporada", { id: "invierno", filtrable: true }, o)).toEqual({ temporadas: ["invierno"] });
    expect(cambioPorFilaDesglose("temporada", { id: "fuera_universo", filtrable: true }, o)).toBeNull();
    expect(cambioPorFilaDesglose("tienda", { id: ID.t03, filtrable: true }, o)).toEqual({ tiendas: [ID.t03] });
    expect(cambioPorFilaDesglose("tienda", { id: ID.t03, filtrable: false }, o)).toBeNull();
    // Y el cambio aplicado da una query que el servidor acepta.
    const q = comoObjeto(consultaTablero(aplicarCambio(FILTROS_VACIOS, cambioPorFilaDesglose("linea", f, o)!, o)));
    expect(tableroQuerySchema.safeParse(q).success).toBe(true);
  });
});

describe("crecimiento declarado, implícito y tendencia", () => {
  const [hu, mu, resto, total] = crecimientos();
  it("HOMBRE · URBANO: contra la tendencia, con las dos cifras de tendencia", () => {
    expect(textoDeclarado(hu, 2026)).toBe("+5.0 % sobre 2026 corregido");
    expect(textoVersion(hu)).toBe("v2 · Planner P. · 06 nov 2026");
    expect(textoImplicito(hu)).toBe("+5.2 % sobre corregido (+6.9 % sobre real)");
    expect(textoTendencia(hu)).toBe("−3.9 % corregida del Niño (−5.9 % en bruto)");
    expect(textoSemaforo(hu)).toBe("contra la tendencia: declara +5.0 %, la venta va −3.9 % corregida del Niño");
    expect(textoTendencia(hu, true)).toContain("el año anterior también fue del Niño: sin corregir");
  });

  it("MUJER · URBANO (sin Niño): una sola cifra y «revisar» con los puntos", () => {
    expect(textoDeclarado(mu, 2026)).toBe("+8.0 % sobre 2026 real");
    expect(textoImplicito(mu)).toBe("+12.3 % sobre real");
    expect(textoTendencia(mu)).toBe("+6.2 %");
    expect(textoSemaforo(mu)).toBe("revisar: +4.3 pp");
  });

  it("el Resto sin crecimiento aplicado dice «sin dato»; el total trae el implícito de la proyección", () => {
    expect(textoDeclarado(resto, 2026)).toBe("sin dato");
    expect(textoImplicito(resto)).toBe("sin dato");
    expect(textoTendencia(resto)).toBe("sin dato");
    expect(textoSemaforo(resto)).toBe("sin dato");
    expect(textoImplicito(total)).toBe("+7.9 % sobre corregido (+9.0 % sobre real)");
  });

  it("tendencia afectada por el Niño: la lectura lo dice", () => {
    expect(textoSemaforo({ ...hu, semaforo: "coincide", tendencia_afectada_nino: true, tendencia_mismas_pct: -2, tendencia_mismas_corregida_pct: 0.1 })).toBe("coincide · tendencia afectada por el Niño");
  });
});

describe("cómo se decidió, apoyo y filas mayores", () => {
  it("por origen, con su parte de las unidades, autores y día pico", () => {
    const v = vistaDecisiones(tablero().decisiones[0]);
    expect(v.total).toBe("52,708");
    expect(v.origenes.map((o) => [o.etiqueta, o.unidades, o.parte])).toEqual([
      ["En bloque", "29,300", "56 %"],
      ["Aceptada tal cual", "13,000", "25 %"],
      ["A mano", "10,408", "20 %"],
    ]);
    expect(v.autores).toEqual([
      { nombre: "Planner P.", registros: "5 filas", unidades: "51,300 u", fechas: "el 07 nov 2026" },
      { nombre: "Admin A.", registros: "1 fila", unidades: "1,408 u", fechas: "el 06 nov 2026" },
    ]);
    expect(v.diaPico).toBe("El día con más decisiones: 07 nov 2026 (5 filas).");
  });

  it("soles: reales, real parcial y estimados, cada estimado marcado", () => {
    const filas = filasSoles(tablero());
    expect(filas.map((f) => [f.etiqueta, f.valor, f.estimado])).toEqual([
      ["2023 real (Niño)", "S/ 1,880,000", false],
      ["2024 real", "S/ 2,016,000", false],
      ["2025 real", "S/ 2,350,000", false],
      ["2026 real ene–oct (Niño)", "S/ 1,991,600", false],
      ["2026 cierre (Niño)", "S/ 2,600,052", true],
      ["2027 proyectado", "S/ 2,740,816", true],
    ]);
  });

  it("cobertura: 6.9 meses con lo proyectado y 7.4 con lo real; con una tienda, sin CD y estimado", () => {
    const c = datosCobertura(tablero().apoyo.cobertura);
    expect(c.map((d) => d.valor)).toEqual(["18,000 u", "12,000 u", "6.9 meses", "7.4 meses"]);
    expect(c.every((d) => !d.estimado)).toBe(true);
    const t03 = datosCobertura(tableroConTienda().apoyo.cobertura);
    expect(t03.map((d) => d.valor)).toEqual(["2,500 u", "no aplica con tiendas elegidas", "3.8 meses", "—"]);
    expect(t03[2].estimado).toBe(true);
  });

  it("filas mayores con su participación y su crecimiento sobre la base", () => {
    const m = filasMayores(tablero().mayores);
    expect(m[0]).toEqual({ fila: "HOMBRE · URBANO · L1 POLOS · AM-A", vigente: "25,000", participacion: "49.7 %", crecimiento: "+6.4 %" });
    expect(m[3].crecimiento).toBe("sin base");
    expect(filasMayores(Array.from({ length: 20 }, (_, i) => ({ fila: `f${i}`, vigente: 1, participacion: 0.01, crecimiento_pct: 1 })))).toHaveLength(10);
  });
});

describe("decisión e historial", () => {
  const f = { resultado: null, motivo: "", comentario: "", confirmo: false } as const;

  it("no deja enviar hasta cumplir las reglas del servidor", () => {
    expect(motivoNoEnviar(f)).toBe("Elige aprobar, aprobar con observaciones o rechazar.");
    expect(motivoNoEnviar({ ...f, resultado: "aprobada" })).toBe("Marca que revisaste las alertas y las cifras de toda la proyección.");
    expect(motivoNoEnviar({ ...f, resultado: "aprobada", confirmo: true })).toBeNull();
    expect(motivoNoEnviar({ ...f, resultado: "rechazada", confirmo: true })).toBe("Para aprobar con observaciones o rechazar, elige un motivo.");
    expect(motivoNoEnviar({ ...f, resultado: "con_observaciones", motivo: "nino", comentario: "  corto  ", confirmo: true })).toBe("Para aprobar con observaciones o rechazar, escribe un comentario de al menos 10 caracteres.");
    expect(motivoNoEnviar({ ...f, resultado: "con_observaciones", motivo: "nino", comentario: "Revisar el factor", confirmo: true })).toBeNull();
    expect(largoComentario("  áéí 😀  ")).toBe(5);
  });

  it("el cuerpo lleva la huella vista, la proyección entera y los filtros vistos, y pasa el esquema real", () => {
    const t = tablero();
    const cuerpo = cuerpoDecision({ resultado: "con_observaciones", motivo: "crecimiento_alto", comentario: "  Revisar MUJER · URBANO  ", confirmo: true }, t, filtros({ generos: [ID.hombre], tiendas: [ID.t03], bloque: "mismas" }));
    expect(cuerpo).toMatchObject({ proyeccion_id: ID.proyeccion, huella_vista: HUELLA, resultado: "con_observaciones", motivo: "crecimiento_alto", comentario: "Revisar MUJER · URBANO", confirmo_revision: true });
    expect(cuerpo.filtros_vistos).toMatchObject({ generos: [ID.hombre], tiendas: [ID.t03], bloque: "mismas" });
    expect(aprobarDireccionSchema.safeParse(cuerpo).success).toBe(true);
    const simple = cuerpoDecision({ resultado: "aprobada", motivo: "", comentario: "  ", confirmo: true }, t, FILTROS_VACIOS);
    expect(simple).toMatchObject({ motivo: null, comentario: null });
    expect(aprobarDireccionSchema.safeParse(simple).success).toBe(true);
  });

  it("el historial va de la más reciente a la más antigua, con hora de Lima, motivo y por qué quedó invalidada", () => {
    const filas = filasHistorial([...historial()].reverse());
    expect(filas.map((h) => h.fecha)).toEqual(["08 nov 2026, 10:30", "05 nov 2026, 09:00", "01 nov 2026, 08:00"]);
    expect(filas[0]).toMatchObject({ etiqueta: "Aprobada", quien: "Admin A.", sobre: "cerrada", invalidada: null, motivo: "" });
    expect(filas[1]).toMatchObject({ etiqueta: "Aprobada con observaciones", motivo: "Crecimiento alto", sobre: "en trabajo", invalidada: "invalidada: la proyección cambió después" });
    expect(filas[2]).toMatchObject({ etiqueta: "Rechazada", motivo: "Efecto del Niño", invalidada: "invalidada por un cambio en el cálculo de la huella" });
  });
});

describe("Excel", () => {
  const args = () => ({ tablero: tableroEnTrabajo(), opciones: opciones(), filtros: filtros({ generos: [ID.hombre], mundo: ID.urbano, tiendas: [ID.t03], bloque: "mismas" as const, desglose: "linea" as const }), bloqueos: vistaBloqueos({ enTrabajo: true, datos: bloqueos(), cargando: false, error: null }), historial: historial(), ahora: "2026-11-10T17:00:00Z" });
  const hojas = hojasTablero(args());

  it("el nombre del archivo y las once hojas de la ficha, cada una con su cabecera", () => {
    expect(nombreArchivoDireccion(2026)).toBe("proyeccion-2026-2027-direccion.xlsx");
    expect(Object.keys(hojas)).toEqual([...HOJAS_DIRECCION]);
    expect(Object.keys(hojas)).toEqual(["RESUMEN", "PUENTE", "ALERTAS", "FRENTE_APROBADA", "MENSUAL", "DESGLOSE", "CRECIMIENTOS", "DECISIONES", "APOYO", "APROBACIONES", "FILTROS"]);
    for (const h of Object.values(hojas)) {
      expect(h.length).toBeGreaterThan(1);
      const ancho = h[0].length;
      for (const filaHoja of h) expect(filaHoja).toHaveLength(ancho);
    }
  });

  it("RESUMEN: proyección, estado, las líneas (con la del cierre), comparativos y la venta que ya no se proyecta", () => {
    const textos = hojas.RESUMEN.map((f) => f.join(" | "));
    expect(textos.some((x) => x.includes("Proyección 2026–2027 seguimiento oct · en trabajo · datos hasta set 2026"))).toBe(true);
    expect(textos.some((x) => x.includes("Estado de dirección | Sin aprobación de dirección"))).toBe(true);
    expect(textos.some((x) => x.includes("2027: 84,714 u, +7.9 % sobre el cierre 2026"))).toBe(true);
    expect(textos.some((x) => x.includes("En trabajo: las cifras pueden cambiar; sin aprobación de dirección vigente; 2 causas bloquearían el cierre."))).toBe(true);
    expect(hojas.RESUMEN.filter((f) => f[0] === "RESUMEN PARA DECIDIR")).toHaveLength(5);
    const comp = hojas.RESUMEN.find((f) => f[1] === "2027 vs 2026 cierre")!;
    expect(comp.slice(2, 4)).toEqual([5.4, 6.9]);
    expect(hojas.RESUMEN.find((f) => f[0] === "FUERA DE LA PROYECCIÓN")).toEqual(["FUERA DE LA PROYECCIÓN", "Venta de filas que ya no se proyectan: 2023", 3100, null, "unidades del recorte sin fila en la proyección"]);
  });

  it("PUENTE: total y por GM, con los rótulos de la pantalla y la suma exacta", () => {
    expect(hojas.PUENTE[0]).toEqual(["PASO", "TIPO", "HOMBRE · URBANO", "MUJER · URBANO", "Resto", "Total", "ACUMULADO TOTAL"]);
    expect(hojas.PUENTE.find((f) => f[0] === "+ Cifras fijadas (a mano o sugeridas por IA)")).toEqual(["+ Cifras fijadas (a mano o sugeridas por IA)", "paso", 117, 1226, 0, 1343, 82306]);
    expect(hojas.PUENTE.at(-1)).toEqual(["2027", "subtotal", 52708, 32006, 0, 84714, 84714]);
  });

  it("ALERTAS incluye las de bloqueo si está en trabajo; MENSUAL lleva TIPO y EXACTITUD", () => {
    expect(hojas.ALERTAS[1]).toEqual(["crecimientos_cambiados", "Bloquea el cierre", "proyección", null, "Los crecimientos aprobados cambiaron después de calcular: recalcúlala antes de cerrar."]);
    expect(hojas.ALERTAS.find((f) => f[0] === "desactualizada")?.[1]).toBe("Se puede cerrar igual");
    expect(hojas.ALERTAS.filter((f) => f[1] === "Importante")).toHaveLength(6);
    expect(hojas.MENSUAL[0]).toEqual(["FILA", "TIPO", "EXACTITUD", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic", "TOTAL"]);
    expect(new Set(hojas.MENSUAL.slice(1).map((f) => f[1]))).toEqual(new Set(["real", "proyectado", "real ene–set + proyectado oct–dic", "sin_nino", "variacion", "comparada"]));
    expect(hojas.MENSUAL.find((f) => f[0] === "2026 cierre")?.[1]).toBe("real ene–set + proyectado oct–dic");
    expect(hojas.MENSUAL.find((f) => f[0] === "2027")?.at(-1)).toBe(52708);
    expect(hojas.MENSUAL.find((f) => f[0] === "2026 real")?.slice(12, 15)).toEqual([4300, null, null]);
  });

  it("FRENTE_APROBADA, DESGLOSE, CRECIMIENTOS, DECISIONES y APROBACIONES", () => {
    expect(hojas.FRENTE_APROBADA[1].slice(0, 4)).toEqual(["MUJER · URBANO", 31000, 32006, 1006]);
    expect(hojas.FRENTE_APROBADA.at(-2)?.slice(0, 5)).toEqual(["Total 2027", 83500, 84714, 1214, 1.5]);
    expect(hojas.DESGLOSE.at(-1)?.slice(0, 8)).toEqual(["linea", "TOTAL", "exacto", 40000, 42000, 47000, 50001, 52708]);
    expect(hojas.CRECIMIENTOS[1].slice(0, 3)).toEqual(["HOMBRE · URBANO", 5, "+5.0 % sobre 2026 corregido"]);
    expect(hojas.CRECIMIENTOS[1].at(-3)).toBe("−3.9 % corregida del Niño (−5.9 % en bruto)");
    expect(hojas.CRECIMIENTOS[3][2]).toBe("sin dato");
    expect(hojas.DECISIONES[1]).toEqual([2027, "origen", "En bloque", 2, 29300, null, null]);
    expect(hojas.APROBACIONES[2]).toEqual(["05 nov 2026, 09:00", "Admin A.", "Aprobada con observaciones", "Crecimiento alto", "Revisar el crecimiento de MUJER · URBANO antes de comprar.", "en trabajo", "invalidada: la proyección cambió después"]);
  });

  it("APOYO marca «estimado» en su columna; FILTROS trae todos los filtros, la comparada, k, k', la huella y la fecha", () => {
    const estimados = hojas.APOYO.filter((f) => f[3] === "estimado").map((f) => `${f[0]} ${f[1] ?? ""}`.trim());
    expect(estimados).toEqual(["Soles 2026", "Soles 2027", "Unidades valorizadas al precio medio del recorte", "Meses de cobertura con la venta proyectada 2026-10"]);
    expect(hojas.APOYO.find((f) => f[0] === "Soles" && f[1] === "2025")?.[3]).toBe("real");
    const fl = new Map(hojas.FILTROS.slice(1).map((f) => [f[0], f[1]] as const));
    expect(fl.get("géneros")).toBe("HOMBRE");
    expect(fl.get("Resto")).toBe("no");
    expect(fl.get("mundo")).toBe("URBANO");
    expect(fl.get("línea")).toBe("—");
    expect(fl.get("temporadas")).toBe("—");
    expect(fl.get("agrupaciones de marca")).toBe("—");
    expect(fl.get("unidad de marca")).toBe("—");
    expect(fl.get("tiendas")).toBe("T03");
    expect(fl.get("bloque")).toBe("Mismas tiendas de 2027");
    expect(fl.get("comparada")).toBe("Proyección 2026–2027 seguimiento set (la última aprobada) · datos hasta set 2026");
    expect(fl.get("datos de la proyección hasta (k)")).toBe("set 2026");
    expect(fl.get("última venta publicada (k')")).toBe("oct 2026");
    expect(fl.get("años del Niño")).toBe("2023, 2026");
    expect(fl.get("huella de cifras")).toBe(HUELLA);
    expect(fl.get("fecha de descarga")).toBe("10 nov 2026, 12:00");
    expect(String(fl.get("exactitud"))).toContain("exactas");
  });

  it("con cifras atribuidas, la nota de exactitud y las notas de atribución lo dicen", () => {
    const h = hojasTablero({ ...args(), tablero: tableroConTienda(), bloqueos: { estado: "no_aplica" } });
    expect(String(h.FILTROS.at(-1)?.[1])).toContain("ESTIMADAS");
    expect(h.APOYO.filter((f) => f[0] === "Atribución por tienda")).toHaveLength(2);
    expect(h.MENSUAL[1][2]).toBe("estimado");
    expect(h.ALERTAS.some((f) => f[1] === "Bloquea el cierre")).toBe(false);
  });
});

describe("avisos en Proyección y en Flujo mensual", () => {
  it("la diferencia con lo aprobado, idéntica o sin aprobaciones", () => {
    expect(textoDiferenciaAprobada(diferencia(), 2027)).toBe("difiere de lo aprobado el 03 nov 2026 en +1,214 u en 2027 (+1.5 %)");
    expect(textoDiferenciaAprobada({ ...diferencia(), identica: true }, 2027)).toBe("idéntica a lo aprobado el 03 nov 2026 en Proyección 2026–2027 seguimiento set");
    expect(textoDiferenciaAprobada(null, 2027)).toBe("no hay aprobaciones anteriores");
  });

  it("cerrada sin aprobación vigente: alerta con quién cerró, cuándo y la diferencia", () => {
    expect(vistaAvisoDireccion(estadoDireccion(), "proyeccion")).toEqual({
      tipo: "alerta",
      rechazada: false,
      antes: "Cerrada por Planner P. el 07 nov 2026 · ",
      fuerte: "sin aprobación de dirección vigente",
      despues: " · difiere de lo aprobado el 03 nov 2026 en +1,214 u en 2027 (+1.5 %)",
      enlace: `/planificacion/aprobacion-direccion?proyeccion=${ID.proyeccion}`,
    });
    expect(vistaAvisoDireccion(estadoDireccion(), "flujo")).toMatchObject({ tipo: "alerta", antes: "El flujo usa Proyección 2026–2027, cerrada por Planner P. el 07 nov 2026 · ", fuerte: "sin aprobación de dirección vigente" });
  });

  it("invalidada y rechazada también avisan; con aprobación vigente, una línea", () => {
    const ultima = { resultado: "aprobada" as const, motivo: null, usuario_nombre: "Admin A.", created_at: "2026-11-08T15:30:00Z" };
    expect(vistaAvisoDireccion(estadoDireccion({ estado: "invalidada", ultima }), "proyeccion")).toMatchObject({ tipo: "alerta", rechazada: false, fuerte: "aprobación invalidada: la proyección cambió después del 08 nov 2026" });
    expect(vistaAvisoDireccion(estadoDireccion({ estado: "rechazada", ultima: { ...ultima, resultado: "rechazada", motivo: "nino" } }), "flujo")).toMatchObject({
      tipo: "alerta",
      rechazada: true,
      antes: "El flujo usa Proyección 2026–2027. Dirección ",
      fuerte: "rechazó",
      despues: " esta proyección el 08 nov 2026 (efecto del Niño) · difiere de lo aprobado el 03 nov 2026 en +1,214 u en 2027 (+1.5 %)",
    });
    expect(vistaAvisoDireccion(estadoDireccion({ estado: "aprobada", vigente: ultima, ultima }), "proyeccion")).toMatchObject({ tipo: "linea", texto: "Dirección: aprobada por Admin A. el 08 nov 2026" });
    expect(vistaAvisoDireccion(estadoDireccion({ estado: "con_observaciones", vigente: { ...ultima, resultado: "con_observaciones" }, ultima }), "flujo")).toMatchObject({ tipo: "linea", texto: "El flujo usa Proyección 2026–2027 · dirección: aprobada con observaciones por Admin A. el 08 nov 2026" });
  });

  it("en trabajo: una línea con el estado; sin cerrada para el flujo: nada", () => {
    expect(vistaAvisoDireccion(estadoDireccion({ proyeccion: proyeccionEnTrabajo() }), "proyeccion")).toMatchObject({ tipo: "linea", texto: "Dirección: sin aprobación de dirección" });
    expect(vistaAvisoDireccion(estadoDireccion({ proyeccion: null, diferencia: null }), "flujo")).toEqual({ tipo: "nada" });
  });

  it("las rutas de lectura del estado", () => {
    expect(urlEstadoDireccion({ paraCompras: true })).toBe("/api/direccion/estado?para=compras");
    expect(urlEstadoDireccion({ proyeccionId: ID.proyeccion })).toBe(`/api/direccion/estado?proyeccion_id=${ID.proyeccion}`);
  });

  it("GM_HU es la clave de género × mundo del fixture", () => {
    expect(GM_HU).toBe(`${ID.hombre}|${ID.urbano}`);
  });
});

describe("T3 · arreglos de qa y seguridad", () => {
  const conComparativo = (t: ReturnType<typeof tablero>, clave: string, cambio: (c: ReturnType<typeof tablero>["kpis"]["comparativos"][number]) => ReturnType<typeof tablero>["kpis"]["comparativos"][number]) => ({
    ...t,
    kpis: { ...t.kpis, comparativos: t.kpis.comparativos.map((c) => (c.clave === clave ? cambio(c) : c)) },
  });

  it("«sobre corregido» sale de `mismas.pct_corregido` del servidor, también con tiendas (sin puente); el puente es solo el respaldo", () => {
    const conTienda = conComparativo(tableroConTienda(), "sig_vs_cierre", (c) => ({ ...c, mismas: { ...c.mismas, pct_corregido: 4.1 } }));
    expect(conTienda.puente.recorte).toBeNull();
    expect(tarjetas(conTienda)[3].lineas[0].texto).toBe("2027 vs 2026: +6.9 % sobre real, +4.1 % sobre corregido (4 tiendas)");
    // `null` del servidor: no hay base corregida; NO se deriva del puente.
    const sinCorregida = conComparativo(tablero(), "sig_vs_cierre", (c) => ({ ...c, mismas: { ...c.mismas, pct_corregido: null } }));
    expect(tarjetas(sinCorregida)[3].lineas[0].texto).toBe("2027 vs 2026: +6.9 % sobre real (4 tiendas)");
    // Campo ausente (servidor anterior): respaldo con el puente.
    expect(pctMismasCorregido(tablero().kpis.comparativos[0], puenteHU())).toBeCloseTo(mismasSobreCorregido(puenteHU())!, 9);
    expect(pctMismasCorregido(undefined, puenteHU())).toBeNull();
  });

  it("«en lo que va» usa `kpis.real_ac_k_prima`; sin el campo, la serie real; con `null`, sin dato", () => {
    const t = tablero();
    const con = tarjetas({ ...t, kpis: { ...t.kpis, real_ac_k_prima: 37777 } })[2];
    expect(con).toMatchObject({ titulo: "2026 en lo que va (ene–oct)", valor: "37,777 u", estimado: false });
    expect(tarjetas({ ...t, kpis: { ...t.kpis, real_ac_k_prima: null } })[2].valor).toBe("— u");
    expect(tarjetas(t)[2].valor).toBe(`${unidades(M2026_REAL.reduce<number>((a, m) => a + (m ?? 0), 0))} u`);
  });

  it("con unidad de marca, el cierre no dice «= real ene–set»: lo rotula «estimado por participación de la marca»; las advertencias van junto al comparativo", () => {
    const [siguiente, cierre, enCurso, mismas] = tarjetas(tableroConMarca());
    expect(cierre.lineas[0].texto).toBe("= ene–set 6,000 (estimado por participación de la marca) + proyectado oct–dic 2,500");
    expect(cierre.lineas[0].texto).not.toContain("real");
    expect(cierre.estimado).toBe(true);
    expect(siguiente.avisos).toEqual([ADVERTENCIA_MARCA]);
    expect(cierre.avisos).toEqual([ADVERTENCIA_MARCA]);
    expect(mismas.avisos).toEqual([ADVERTENCIA_MARCA]);
    expect(enCurso.avisos).toEqual([]);
    expect(enCurso.valor).toBe("6,650 u");
    // Sin marca (exacto): la línea de siempre, sin avisos.
    expect(tarjetas(tablero())[1].lineas[0].texto).toBe("= real ene–set 34,000 + proyectado oct–dic 16,001");
    expect(tarjetas(tablero()).flatMap((x) => x.avisos)).toEqual([]);
  });

  it("tabla mensual: en la fila del cierre, de enero a k es real y de k+1 a diciembre proyectado; cada fila con su exactitud", () => {
    const filas = filasTablaMensual(tablero());
    const cierre = filas.find((f) => f.clave === "cierre-2026")!;
    expect(cierre.proyectado).toBe(false);
    expect(cierre.mesProyectado).toEqual([false, false, false, false, false, false, false, false, false, true, true, true]);
    expect(cierre.totalProyectado).toBe(false);
    expect(cierre.composicion).toBe("real ene–set + proyectado oct–dic");
    const sig = filas.find((f) => f.clave === "proyectado-2027")!;
    expect(sig).toMatchObject({ proyectado: true, totalProyectado: true, composicion: null });
    expect(sig.mesProyectado.every(Boolean)).toBe(true);
    expect(filas.find((f) => f.clave === "real-2025")!.mesProyectado.some(Boolean)).toBe(false);
    expect(esFilaCierre("cierre_2026")).toBe(true);
    expect(esFilaCierre("comparada_2026")).toBe(false);
    const marca = filasTablaMensual(tableroConMarca());
    expect(marca.map((f) => [f.clave, f.estimado])).toEqual([
      ["real_2025", false],
      ["cierre_2026", true],
      ["proyectado_2027", true],
    ]);
  });

  it("la nota del servidor bajo la tabla mensual; sin filas «Sin atribuir» no pasa nada", () => {
    expect(notaTablaMensual(tableroConTienda())).toBe(NOTA_SIN_ATRIBUIR);
    expect(notaTablaMensual(tablero())).toBeNull();
    const t = tablero();
    expect(notaTablaMensual({ tabla_mensual: { ...t.tabla_mensual, nota: "  " } })).toBeNull();
    const sinAtribuir = { ...tableroConTienda(), tabla_mensual: { filas: tableroConTienda().tabla_mensual.filas.filter((f) => !/sin.atribuir/.test(f.clave)), nota: null } };
    expect(filasTablaMensual(sinAtribuir).map((f) => f.clave)).toEqual(["proyectado-2027"]);
  });

  it("desglose: «Sin participación por marca» (y «Sin atribuir», «Fuera de la proyección») no se aplica como filtro, va al final y lleva su ayuda", () => {
    const d = desgloseMarca();
    expect(cambioPorFilaDesglose("marca", d.filas[0], opciones())).toBeNull();
    expect(cambioPorFilaDesglose("marca", { id: "sin_marca", filtrable: true }, opciones())).toBeNull();
    expect(cambioPorFilaDesglose("tienda", { id: "sin_atribuir", filtrable: true }, opciones())).toBeNull();
    expect(cambioPorFilaDesglose("temporada", { id: "fuera_universo", filtrable: true }, opciones())).toBeNull();
    expect(cambioPorFilaDesglose("marca", d.filas[1], opciones())).toEqual({ marca: ID.marcaX });
    expect(ordenarDesglose(d.filas, 2027).map((f) => f.id)).toEqual([ID.marcaX, ID.marcaZ, "sin_marca"]);
    expect(ayudaFilaDesglose("sin_marca")).toBe("Unidades de filas sin participación por marca.");
    expect(ayudaFilaDesglose(ID.marcaX)).toBeNull();
  });

  it("«el total cuadra con las tarjetas» solo se dice si es cierto en este desglose", () => {
    expect(totalDesgloseCuadra(tablero())).toBe(true);
    expect(totalDesgloseCuadra({ ...tablero(), desglose: desgloseMarca() })).toBe(true);
    const t = tablero();
    expect(totalDesgloseCuadra({ ...t, kpis: { ...t.kpis, siguiente: 52000 } })).toBe(false);
    expect(totalDesgloseCuadra({ ...t, kpis: { ...t.kpis, cierre: 49000 } })).toBe(false);
    expect(totalDesgloseCuadra({ ...t, desglose: { ...t.desglose, filas: [] } })).toBe(false);
  });

  it("«Comparar con»: la primera opción sale de la comparada real de la proyección mostrada", () => {
    const aprobada = { ...proyeccion(), motivo: "aprobada" as const, huella_igual_a_aprobada: true };
    // El caso de qa: se mira una en trabajo; `opciones.comparar_por_defecto` (relativa a la por defecto) no tiene otra aprobada, pero la mostrada sí compara con una.
    const enTrabajo = { ...tableroEnTrabajo(), comparada: aprobada };
    expect(textoCompararPorDefecto({ comparar: null }, enTrabajo)).toBe("La última aprobada: Proyección 2026–2027");
    expect(textoComparando(enTrabajo)).toBe("Comparando con «Proyección 2026–2027» (la última aprobada) · datos hasta set 2026");
    expect(textoCompararPorDefecto({ comparar: null }, { comparada: null })).toBe("La última aprobada (no hay otra aprobada)");
    expect(textoComparando({ comparada: null })).toBeNull();
    // Con otra elegida o sin tablero, la opción no afirma nada.
    expect(textoCompararPorDefecto({ comparar: ID.seguimiento }, enTrabajo)).toBe("La última aprobada");
    expect(textoCompararPorDefecto({ comparar: null }, null)).toBe("La última aprobada");
  });

  it("resumen: la causa del cierre se funde con la 5.ª línea del servidor (3 a 5 líneas, nunca 6)", () => {
    const v = vistaBloqueos({ enTrabajo: true, datos: bloqueos(), cargando: false, error: null });
    const r = lineasResumen(tableroEnTrabajo().decidir.lineas, v);
    expect(r.lineas).toHaveLength(5);
    expect(r.viva).toBe(4);
    expect(r.lineas[4]).toBe("En trabajo: las cifras pueden cambiar; sin aprobación de dirección vigente; 2 causas bloquearían el cierre.");
    expect(lineasResumen(tableroEnTrabajo().decidir.lineas, { estado: "cargando" }).lineas[4]).toBe("En trabajo: las cifras pueden cambiar; sin aprobación de dirección vigente; comprobando qué bloquearía el cierre…");
    // Cerrada: las del servidor, tal cual.
    expect(lineasResumen(LINEAS_DECIDIR, { estado: "no_aplica" })).toEqual({ lineas: LINEAS_DECIDIR, viva: null });
    // Pocas líneas y ninguna de «En trabajo»: va como línea propia.
    expect(lineasResumen(LINEAS_DECIDIR.slice(0, 3), v)).toEqual({ lineas: [...LINEAS_DECIDIR.slice(0, 3), "En trabajo; 2 causas bloquearían el cierre"], viva: 3 });
    // Cinco sin «En trabajo»: se suma a la última.
    expect(lineasResumen(LINEAS_DECIDIR, v).lineas).toHaveLength(5);
  });

  it("enlaces de las alertas: solo rutas internas de verdad (no «//host» ni «/\\host»)", () => {
    expect(esEnlaceInterno("/planificacion/proyeccion?pestana=crecimientos")).toBe(true);
    expect(esEnlaceInterno("/maestros/tiendas")).toBe(true);
    for (const malo of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "planificacion", "", null, undefined]) expect(esEnlaceInterno(malo)).toBe(false);
  });

  it("signo menos «−» (U+2212) en todos los negativos que formatea la pantalla de M14", () => {
    expect(unidades(-12)).toBe("−12");
    expect(unidades(-0.4)).toBe("0");
    expect(unidadesConSigno(-1214)).toBe("−1,214");
    expect(porcentaje(-3.94)).toBe("−3.9 %");
    expect(porcentaje(-0.04)).toBe("0.0 %");
    expect(puntos(-4.3)).toBe("−4.3 pp");
    expect(participacion(-0.05)).toBe("−5.0 %");
    expect(soles(-1500)).toBe("S/ −1,500");
    expect(mesesCobertura(-1)).toBe("−1.0 meses");
    expect(MENOS).toBe("−");
    for (const t of [unidades(-5), unidadesConSigno(-5), porcentaje(-5), puntos(-5)]) expect(t).not.toContain("-");
  });

  it("aviso de Proyección y Flujo: ámbar sin aprobación vigente o invalidada; rojo solo si dirección rechazó", () => {
    const ultima = { resultado: "aprobada" as const, motivo: null, usuario_nombre: "Admin A.", created_at: "2026-11-08T15:30:00Z" };
    const sin = vistaAvisoDireccion(estadoDireccion(), "proyeccion");
    const invalidada = vistaAvisoDireccion(estadoDireccion({ estado: "invalidada", ultima }), "proyeccion");
    const rechazada = vistaAvisoDireccion(estadoDireccion({ estado: "rechazada", ultima: { ...ultima, resultado: "rechazada" } }), "flujo");
    if (sin.tipo !== "alerta" || invalidada.tipo !== "alerta" || rechazada.tipo !== "alerta") throw new Error("se esperaban alertas");
    expect(tonoAviso(sin)).toBe("aviso");
    expect(tonoAviso(invalidada)).toBe("aviso");
    expect(tonoAviso(rechazada)).toBe("alerta");
  });

  it("Excel: TIPO del cierre con sus meses reales y proyectados, EXACTITUD de cada fila, la nota de la tabla mensual y las advertencias", () => {
    const h = hojasTablero({ tablero: tableroConMarca(), opciones: opciones(), filtros: FILTROS_VACIOS, bloqueos: { estado: "no_aplica" }, historial: [], ahora: "2026-11-10T15:00:00Z" });
    expect(h.MENSUAL.slice(1).map((f) => f.slice(0, 3))).toEqual([
      ["2025", "real", "exacto"],
      ["2026 cierre", "real ene–set + proyectado oct–dic", "estimado"],
      ["2027", "proyectado", "estimado"],
    ]);
    const comp = h.RESUMEN.find((f) => f[1] === "2027 vs 2025 (último año normal)")!;
    expect(String(comp[4])).toContain(ADVERTENCIA_MARCA);
    expect(String(h.RESUMEN.find((f) => f[1] === "2027 vs 2026 cierre")![4])).not.toContain(ADVERTENCIA_MARCA);
    const conNota = hojasTablero({ tablero: tableroConTienda(), opciones: opciones(), filtros: FILTROS_VACIOS, bloqueos: { estado: "no_aplica" }, historial: [], ahora: "2026-11-10T15:00:00Z" });
    const nota = conNota.MENSUAL.at(-1)!;
    expect(nota[0]).toBe("NOTA");
    expect(nota[3]).toBe(NOTA_SIN_ATRIBUIR);
    expect(nota).toHaveLength(conNota.MENSUAL[0].length);
    expect(h.MENSUAL.some((f) => f[0] === "NOTA")).toBe(false);
    expect(tipoMensual("proyectado", { clave: "cierre_2026", k: 12 })).toBe("real");
    expect(tipoMensual("proyectado", { clave: "proyectado_2027", k: 9 })).toBe("proyectado");
    expect(tipoMensual("proyectado")).toBe("proyectado");
  });
});

describe("T3 · aviso del reparto estimado por marca con tiendas o bloque", () => {
  it("solo avisa por marca y con un conjunto de tiendas recortado", async () => {
    const { descripcionDesglose } = await import("@/app/(app)/planificacion/aprobacion-direccion/vista-tablero");
    type T = Parameters<typeof descripcionDesglose>[0];
    const total = { anios: [] } as unknown as T["desglose"]["total"];
    const con = (dimension: T["desglose"]["dimension"], conjunto: T["filtros"]["conjunto_tiendas"]): T =>
      ({
        desglose: { dimension, filas: [], total },
        kpis: { siguiente: 0, cierre: 0 },
        proyeccion: { anio_en_curso: 2026, anio_siguiente: 2027 },
        filtros: { texto: "", exactitud: "estimado", conjunto_tiendas: conjunto },
      }) as unknown as T;
    const conjunto = { etiqueta: "Tiendas elegidas (1): T03", codigos: ["T03"] };
    expect(descripcionDesglose(con("marca", conjunto))).toContain("el reparto por marca es estimado");
    expect(descripcionDesglose(con("marca", null))).not.toContain("estimado");
    expect(descripcionDesglose(con("linea", conjunto))).not.toContain("estimado");
  });
});
