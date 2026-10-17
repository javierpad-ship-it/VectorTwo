import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CeldaDecision } from "../src/app/(app)/planificacion/proyeccion/celda-decision";
import { GraficoMarcas } from "../src/app/(app)/planificacion/proyeccion/grafico-marcas";
import { TablaFilas } from "../src/app/(app)/planificacion/proyeccion/tabla-filas";
import { TarjetaTienda } from "../src/app/(app)/planificacion/proyeccion/tarjeta-tienda";
import {
  barrasMarcas,
  claveFilaBase,
  construirBarras,
  marcasDeClave,
  nombresDeTiendas,
  notaMoverTienda,
  ofreceUsarSumaFilas,
  porcentajesQueSuman100,
  repartirEntero,
  repartoPorMarca,
  seccionesApertura,
  sumaApertura,
  sumaFilasYaDecidida,
  tablaRepartoApertura,
  textoFilasFijadas,
  textoPeriodoMarcas,
  textoReparto,
  textoTotalTienda,
  textoTotalTiendaTras,
  tituloSeccionApertura,
  totalLinea,
  TEXTO_SIN_DATOS_MARCA,
} from "../src/app/(app)/planificacion/proyeccion/vista";
import { bloques, filaApertura, filasDenim, marcasDenim, nodo, proyeccion, registro, respuestaLineas, tiendaProyeccion, Y } from "./proyeccion.pantalla.fixture";

/** 07b (0.10.7), lado pantalla: apertura editable en la línea y marcas de más peso. Datos sintéticos (T10, T12): nada real de Lukers. */

const suma = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);
const nombres = () => nombresDeTiendas(bloques());
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};
const sinAsync = () => Promise.resolve(true);
const sinVoid = () => Promise.resolve();

describe("repartirEntero", () => {
  it("reparte en enteros que suman exactamente el total", () => {
    expect(repartirEntero(210, [0.4, 0.3, 0.2, 0.1])).toEqual([84, 63, 42, 21]);
    for (const total of [0, 1, 7, 64, 99, 210, 497, 7840]) {
      for (const pesos of [[0.4, 0.25, 0.15, 0.2], [1 / 3, 1 / 3, 1 / 3], [0.7, 0.3], [0.05, 0.05, 0.9], [1]]) {
        const r = repartirEntero(total, pesos);
        expect(suma(r), `${total} ${pesos}`).toBe(total);
        expect(r.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
      }
    }
  });

  it("el mayor resto se lleva la unidad que sobra y el empate va al primero", () => {
    expect(repartirEntero(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(repartirEntero(64, [0.7, 0.3])).toEqual([45, 19]);
    expect(repartirEntero(497, [0.7, 0.3])).toEqual([348, 149]);
  });

  it("con total 0, sin pesos o con pesos nulos todo es 0; los pesos inválidos cuentan como 0", () => {
    expect(repartirEntero(0, [0.5, 0.5])).toEqual([0, 0]);
    expect(repartirEntero(100, [])).toEqual([]);
    expect(repartirEntero(100, [0, 0])).toEqual([0, 0]);
    expect(repartirEntero(100, [Number.NaN, -1, 1])).toEqual([0, 0, 100]);
    expect(repartirEntero(-5, [1, 1])).toEqual([0, 0]);
  });
});

describe("repartoPorMarca (en pantalla)", () => {
  const [reconocido, , , premium] = marcasDenim();

  it("reparte la cifra de la fila con las 3 marcas y «otras»; la suma es la cifra", () => {
    const partes = repartoPorMarca(300, reconocido);
    expect(partes?.map((p) => p.unidades)).toEqual([120, 75, 45, 60]);
    expect(suma(partes?.map((p) => p.unidades) ?? [])).toBe(300);
    expect(textoReparto(partes ?? [])).toBe("MARCA A 120 · MARCA B 75 · MARCA C 45 · otras 60");
    expect(partes?.map((p) => p.otras)).toEqual([false, false, false, true]);
  });

  it("con menos de 3 marcas y sin «otras» reparte solo entre las que hay", () => {
    expect(repartoPorMarca(64, premium)).toEqual([
      { nombre: "MARCA I", unidades: 45, otras: false },
      { nombre: "MARCA J", unidades: 19, otras: false },
    ]);
  });

  it("con vigente 0 o nulo todo es 0, y sin composición devuelve null", () => {
    expect(repartoPorMarca(0, reconocido)?.every((p) => p.unidades === 0)).toBe(true);
    expect(repartoPorMarca(null, reconocido)?.every((p) => p.unidades === 0)).toBe(true);
    expect(repartoPorMarca(100, undefined)).toBeNull();
    expect(repartoPorMarca(100, { ...reconocido, top: [], otras: null })).toBeNull();
  });
});

describe("secciones de apertura en la tabla de la línea", () => {
  it("una sección por tienda nueva y año, con el nombre de la tienda y el título de la ficha", () => {
    const s = seccionesApertura(respuestaLineas(), [Y, Y + 1], nombres());
    expect(s.map((x) => `${x.anio} ${x.codigo}`)).toEqual(["2026 T10", "2027 T12"]);
    expect(tituloSeccionApertura(s[1])).toBe("Aperturas 2027 · T12 · Tienda nueva B · abre 2027-03-15 · referente T03");
    expect(tituloSeccionApertura(s[0])).toBe("Nueva del año anterior 2026 · T10 · Tienda nueva A · abre 2025-11-20 · composición de la red");
    expect(s[1].vigente_en_linea).toBe(484);
  });

  it("una fila por agrupación de marca en el orden de las filas base; la que el referente no vende queda sin fila", () => {
    const [, t12] = seccionesApertura(respuestaLineas(), [Y, Y + 1], nombres());
    expect(t12.filas.map((f) => [f.nombre, f.fila !== null])).toEqual([
      ["RECONOCIDO", true],
      ["MID VALUE", true],
      ["VALOR", false],
      ["PREMIUM", true],
      ["ULTRA LOW", false],
    ]);
    expect(t12.filas.filter((f) => f.fila).map((f) => f.registro?.anio)).toEqual([2027, 2027, 2027]);
  });

  it("solo entran las filas activas con registro `nuevas` del año; las de otras tiendas no se mezclan", () => {
    const l = respuestaLineas();
    const inactiva = { ...filaApertura("VALOR", "tienda-12", "T12", [{ anio: Y + 1, propuesto: 10, vigente: 10 }]), activo: false };
    const deMismas = filaApertura("ULTRA LOW", "tienda-12", "T12", [{ anio: Y + 1, propuesto: 10, vigente: 10 }]);
    deMismas.anios[0] = { ...deMismas.anios[0], bloque: "mismas" };
    const s = seccionesApertura({ ...l, filas_tienda: [...l.filas_tienda, inactiva, deMismas] }, [Y + 1]);
    expect(s).toHaveLength(1);
    expect(s[0].filas.filter((f) => f.fila).map((f) => f.nombre)).toEqual(["RECONOCIDO", "MID VALUE", "PREMIUM"]);
  });

  it("una agrupación que solo existe en la tienda (sin fila base) se agrega al final", () => {
    const l = respuestaLineas();
    const filas_tienda = [...l.filas_tienda, filaApertura("NUEVA AGRUPACION", "tienda-12", "T12", [{ anio: Y + 1, propuesto: 5, vigente: 5 }])];
    const [t12] = seccionesApertura({ ...l, filas_tienda }, [Y + 1]);
    expect(t12.filas[t12.filas.length - 1].nombre).toBe("NUEVA AGRUPACION");
  });

  it("sin tiendas nuevas en el año no hay sección; sin nombres, el nombre queda vacío", () => {
    const l = respuestaLineas({ tiendas_linea: [], filas_tienda: [] });
    expect(seccionesApertura(l, [Y, Y + 1])).toEqual([]);
    expect(seccionesApertura(respuestaLineas(), [Y + 1])[0].nombre).toBeNull();
  });

  it("en un nodo GMLE la fila de apertura se empareja por equivalencia × agrupación de marca", () => {
    const l = respuestaLineas();
    const base = filasDenim()
      .slice(0, 1)
      .flatMap((f) => [
        { ...f, id: "b-e1", equivalencia_id: "e1", equivalencia: "EQ UNO", nivel: "GMLE" as const },
        { ...f, id: "b-e2", equivalencia_id: "e2", equivalencia: "EQ DOS", nivel: "GMLE" as const },
      ]);
    const ap = filaApertura("RECONOCIDO", "tienda-12", "T12", [{ anio: Y + 1, propuesto: 50, vigente: 50 }], { equivalencia_id: "e2", equivalencia: "EQ DOS", nivel: "GMLE" });
    const [t12] = seccionesApertura({ filas: base, tiendas_linea: l.tiendas_linea, filas_tienda: [ap] }, [Y + 1]);
    expect(t12.filas.map((f) => [f.nombre, f.fila !== null])).toEqual([
      ["EQ UNO · RECONOCIDO", false],
      ["EQ DOS · RECONOCIDO", true],
    ]);
    expect(claveFilaBase(base[0])).not.toBe(claveFilaBase(base[1]));
  });
});

describe("totales de la línea con la apertura", () => {
  it("«Tiendas nuevas» suma las filas de apertura de cada año y «Total línea» le suma las filas base", () => {
    const l = respuestaLineas();
    expect(sumaApertura(l, 2026)).toBe(4797);
    expect(sumaApertura(l, 2027)).toBe(484);
    expect(totalLinea(l, 2026)).toBe(45204 + 4797);
    expect(totalLinea(l, 2027)).toBe(52724 + 484);
  });

  it("el total de la línea es la barra anual y la columna de la Matriz", () => {
    const l = respuestaLineas();
    const [, , , y, s] = construirBarras({ anioEnCurso: Y, lineas: l, bloques: bloques() });
    expect(totalLinea(l, 2026)).toBe(y.total);
    expect(totalLinea(l, 2027)).toBe(s.total);
    const n = nodo("linea", "DENIM", {});
    expect(totalLinea(l, 2026)).toBe(n.en_curso.total);
    expect(totalLinea(l, 2027)).toBe(n.siguiente.total);
  });

  it("las filas de apertura nunca entran en los totales de las filas base", () => {
    const l = respuestaLineas();
    const sinTienda = respuestaLineas({ filas_tienda: [] });
    expect(sumaApertura(sinTienda, 2027)).toBe(0);
    expect(totalLinea(sinTienda, 2027)).toBe(52724);
    expect(l.totales_por_anio.find((t) => t.anio === 2027)?.vigente).toBe(52724);
  });

  it("al mover una fila el total de la línea cambia solo en lo movido", () => {
    const l = respuestaLineas();
    const movida = l.filas_tienda.map((f) => (f.id.includes("T12-RECONOCIDO") ? { ...f, anios: f.anios.map((a) => ({ ...a, vigente: 400, decidido: 400, origen: "manual" as const })) } : f));
    expect(totalLinea({ ...l, filas_tienda: movida }, 2027)).toBe(totalLinea(l, 2027) + 100);
  });
});

describe("el total de la tienda al mover una fila («solo se mueve lo modificado»)", () => {
  const decidido = { propuesto: 7840, decidido: 7840 };

  it("la nota dice a cuánto pasa el total de la tienda: D + Δ", () => {
    expect(notaMoverTienda({ vigenteFila: 300, nueva: 400, total: decidido })).toBe("Cambia solo esta fila; el total de la tienda pasa a 7,940.");
    expect(notaMoverTienda({ vigenteFila: 300, nueva: 250, total: decidido })).toBe("Cambia solo esta fila; el total de la tienda pasa a 7,790.");
  });

  it("sin total decidido en la tienda solo se fija la fila y la tienda sigue sin decidir", () => {
    expect(notaMoverTienda({ vigenteFila: 300, nueva: 400, total: { propuesto: 9100, decidido: null } })).toBe("Cambia solo esta fila; la tienda aún no tiene total decidido y las demás filas no se tocan.");
  });

  it("sin cifra válida o sin cambio no hay nota; el total nunca baja de 0", () => {
    expect(notaMoverTienda({ vigenteFila: 300, nueva: null, total: decidido })).toBeNull();
    expect(notaMoverTienda({ vigenteFila: 300, nueva: 300, total: decidido })).toBeNull();
    expect(notaMoverTienda({ vigenteFila: null, nueva: 300, total: decidido })).toBeNull();
    expect(notaMoverTienda({ vigenteFila: 9000, nueva: 0, total: { propuesto: 100, decidido: 100 } })).toBe("Cambia solo esta fila; el total de la tienda pasa a 0.");
  });

  it("la cabecera dice el total de la tienda y el aviso de después muestra el total ya actualizado", () => {
    expect(textoTotalTienda({ propuesto: 7840, decidido: 7840 })).toBe("total de la tienda: 7,840 decididas");
    expect(textoTotalTienda({ propuesto: 7840, decidido: null })).toBe("total de la tienda: sin decidir, propuesta 7,840");
    expect(textoTotalTienda({ propuesto: null, decidido: null })).toBe("total de la tienda: sin propuesta");
    expect(textoTotalTiendaTras("T12", { anio: 2027, decidido: 7940, suma_filas: 7940 })).toBe("El total de T12 en 2027 queda en 7,940 (suma de sus filas: 7,940).");
    expect(textoTotalTiendaTras("T12", { anio: 2027, decidido: null, suma_filas: 7840 })).toBe("T12 en 2027 sigue sin total decidido (suma de sus filas: 7,840).");
  });
});

describe("gráfico de marcas por agrupación", () => {
  const base = () => filasDenim();

  it("una barra por agrupación en el orden de la línea; las que no tienen composición salen «sin datos»", () => {
    const b = barrasMarcas(base(), marcasDenim());
    expect(b.map((x) => x.etiqueta)).toEqual(["RECONOCIDO", "MID VALUE", "VALOR", "PREMIUM", "ULTRA LOW"]);
    expect(b.map((x) => x.sinDatos)).toEqual([false, false, false, false, true]);
    expect(b[4].segmentos).toEqual([]);
    expect(b[4].aria).toContain(TEXTO_SIN_DATOS_MARCA);
  });

  it("las 3 marcas más «Otras (N)» con su % real, de izquierda a derecha, llenan el 100 %", () => {
    const [reconocido] = barrasMarcas(base(), marcasDenim());
    expect(reconocido.segmentos.map((s) => s.nombre)).toEqual(["MARCA A", "MARCA B", "MARCA C", "Otras (6)"]);
    expect(reconocido.segmentos.map((s) => s.pct)).toEqual(["40.0 %", "25.0 %", "15.0 %", "20.0 %"]);
    expect(reconocido.segmentos.map((s) => s.indice)).toEqual([0, 1, 2, 3]);
    expect(reconocido.segmentos.map((s) => Math.round(s.x))).toEqual([0, 40, 65, 80]);
    const ultimo = reconocido.segmentos[3];
    expect(ultimo.x + ultimo.ancho).toBeCloseTo(100, 5);
    expect(reconocido.aria).toBe("RECONOCIDO: MARCA A 40.0 %, MARCA B 25.0 %, MARCA C 15.0 %, Otras (6) 20.0 %");
  });

  it("con menos de 3 marcas y sin «otras» se muestran las que hay y también suman el 100 %", () => {
    const premium = barrasMarcas(base(), marcasDenim())[3];
    expect(premium.segmentos.map((s) => s.nombre)).toEqual(["MARCA I", "MARCA J"]);
    const ultimo = premium.segmentos[1];
    expect(ultimo.x + ultimo.ancho).toBeCloseTo(100, 5);
  });

  it("los porcentajes de 1 decimal suman exactamente 100 % cuando las participaciones suman 1", () => {
    const pcts = porcentajesQueSuman100([1 / 3, 1 / 3, 1 / 3]);
    expect(pcts).toEqual(["33.4 %", "33.3 %", "33.3 %"]);
    const num = (t: string) => Number(t.replace(" %", ""));
    expect(Math.round(suma(pcts.map(num)) * 10)).toBe(1000);
    // Si no suman 1 (no se inventa nada) se muestra el real de cada una.
    expect(porcentajesQueSuman100([0.5, 0.25])).toEqual(["50.0 %", "25.0 %"]);
  });

  it("empareja por agrupación de marca y equivalencia (nodo GMLE)", () => {
    const [m] = marcasDenim();
    const marcas = [{ ...m, equivalencia_id: "e1" }, { ...m, equivalencia_id: "e2", top: [{ marca_id: "x", marca: "OTRA", participacion: 1 }], otras: null }];
    const fila = { equivalencia_id: "e2", agrupacion_marca_id: m.agrupacion_marca_id };
    expect(marcasDeClave(marcas, fila)?.top[0].marca).toBe("OTRA");
    expect(marcasDeClave(marcas, { equivalencia_id: null, agrupacion_marca_id: m.agrupacion_marca_id })).toBeUndefined();
  });

  it("el pie dice sobre qué doce meses y cuántas tiendas se midió, sin normalizar por el Niño", () => {
    expect(textoPeriodoMarcas(marcasDenim())).toBe("Unidades de los últimos 12 meses de las mismas tiendas (2025-10 a 2026-09, 9 tiendas), sin normalizar por el Niño.");
    expect(textoPeriodoMarcas([])).toBeNull();
    expect(textoPeriodoMarcas(marcasDenim().map((m) => ({ ...m, periodo: null })))).toBeNull();
  });

  it("sin filas base o con filas de tienda mezcladas no hay barras de más", () => {
    expect(barrasMarcas([], marcasDenim())).toEqual([]);
    const mezcladas = [...base(), filaApertura("RECONOCIDO", "tienda-12", "T12", [{ anio: Y + 1, propuesto: 1, vigente: 1 }])];
    expect(barrasMarcas(mezcladas, marcasDenim())).toHaveLength(5);
  });
});

describe("reparto de la apertura por marca (tabla alternativa)", () => {
  it("cada fila de apertura se reparte con la composición de su agrupación y suma la cifra de la fila", () => {
    const l = respuestaLineas();
    const filas = tablaRepartoApertura(seccionesApertura(l, [Y + 1], nombres()), l.marcas);
    expect(filas.map((f) => f.estado)).toEqual(["ok", "ok", "sin_fila", "ok", "sin_fila"]);
    const reconocido = filas.find((f) => f.agrupacion === "RECONOCIDO");
    expect(reconocido?.seccion).toBe("T12 · 2027");
    expect(reconocido?.vigente).toBe(300);
    expect(textoReparto(reconocido?.partes ?? [])).toBe("MARCA A 120 · MARCA B 75 · MARCA C 45 · otras 60");
    for (const f of filas.filter((x) => x.estado === "ok")) expect(suma(f.partes?.map((p) => p.unidades) ?? [])).toBe(f.vigente);
  });

  it("una fila de apertura cuya agrupación no trae composición queda «sin_marcas» y se edita igual", () => {
    const l = respuestaLineas();
    const ultra = filaApertura("ULTRA LOW", "tienda-12", "T12", [{ anio: Y + 1, propuesto: 30, vigente: 30 }]);
    const filas = tablaRepartoApertura(seccionesApertura({ ...l, filas_tienda: [...l.filas_tienda, ultra] }, [Y + 1]), l.marcas);
    const f = filas.find((x) => x.agrupacion === "ULTRA LOW");
    expect(f?.estado).toBe("sin_marcas");
    expect(f?.partes).toBeNull();
    expect(f?.vigente).toBe(30);
  });

  it("sin tiendas nuevas la tabla queda vacía (la pantalla dice «sin tiendas nuevas»)", () => {
    const l = respuestaLineas({ tiendas_linea: [], filas_tienda: [] });
    expect(tablaRepartoApertura(seccionesApertura(l, [Y, Y + 1]), l.marcas)).toEqual([]);
  });
});

describe("tarjeta de Tiendas nuevas: filas fijadas y suma de filas", () => {
  it("dice cuántas filas hay fijadas y la suma de filas; sin filas fijadas no dice nada", () => {
    expect(textoFilasFijadas(tiendaProyeccion({ filas_fijadas: 2, suma_filas: 7940 }))).toBe("2 filas fijadas a mano (también desde Por línea) · suma de filas 7,940");
    expect(textoFilasFijadas(tiendaProyeccion({ filas_fijadas: 1, suma_filas: 7940 }))).toContain("1 fila fijada a mano");
    expect(textoFilasFijadas(tiendaProyeccion({ filas_fijadas: 2, suma_filas: null }))).toBe("2 filas fijadas a mano (también desde Por línea)");
    expect(textoFilasFijadas(tiendaProyeccion({ filas_fijadas: 0, suma_filas: 7840 }))).toBeNull();
  });

  it("«Usar la suma de filas» se ofrece solo en una tienda nueva con filas fijadas y suma conocida", () => {
    expect(ofreceUsarSumaFilas(tiendaProyeccion({ filas_fijadas: 2, suma_filas: 7940 }))).toBe(true);
    expect(ofreceUsarSumaFilas(tiendaProyeccion({ filas_fijadas: 0, suma_filas: 7940 }))).toBe(false);
    expect(ofreceUsarSumaFilas(tiendaProyeccion({ filas_fijadas: 2, suma_filas: null }))).toBe(false);
    expect(ofreceUsarSumaFilas(tiendaProyeccion({ filas_fijadas: 2, suma_filas: 7940, bloque: "cierres", subbloque: null }))).toBe(false);
  });

  it("el botón no hace nada si la suma ya es el total decidido", () => {
    expect(sumaFilasYaDecidida(tiendaProyeccion({ decidido: 7940, suma_filas: 7940 }))).toBe(true);
    expect(sumaFilasYaDecidida(tiendaProyeccion({ decidido: 7840, suma_filas: 7940 }))).toBe(false);
    expect(sumaFilasYaDecidida(tiendaProyeccion({ decidido: null, suma_filas: 7940 }))).toBe(false);
    expect(sumaFilasYaDecidida(tiendaProyeccion({ decidido: 7840, suma_filas: null }))).toBe(false);
  });
});

describe("render de la apertura en la línea", () => {
  const datos = respuestaLineas();
  const secciones = seccionesApertura(datos, [Y, Y + 1], nombres());
  const tabla = (extra: { bloqueada?: boolean; secciones?: typeof secciones } = {}) =>
    html(
      createElement(TablaFilas, {
        filas: datos.filas,
        lineas: datos,
        secciones: extra.secciones ?? secciones,
        anioEnCurso: Y,
        bloqueada: extra.bloqueada ?? false,
        ocupado: false,
        filaSeleccionada: null,
        onSeleccionar: noop,
        onDecidir: sinAsync,
        onVerTienda: noop,
        onCsv: noop,
      })
    );

  it("la sección de cada tienda trae su cabecera, el total de la tienda y el enlace a la tienda", () => {
    const s = tabla();
    expect(s).toContain("Aperturas 2027 · T12 · Tienda nueva B · abre 2027-03-15 · referente T03");
    expect(s).toContain("total de la tienda: 7,840 decididas");
    expect(s).toContain("Nueva del año anterior 2026 · T10 · Tienda nueva A");
    expect(s).toContain("total de la tienda: sin decidir, propuesta 9,100");
    expect(s).toContain("Ver la tienda");
  });

  it("cada fila de apertura es editable con etiqueta clara de la tienda y el año; las agrupaciones sin fila lo dicen", () => {
    const s = tabla();
    expect(s).toContain('aria-label="RECONOCIDO, T12 decidido 2027"');
    expect(s).toContain('aria-label="PREMIUM, T10 decidido 2026"');
    expect(s).toContain("Aceptar la propuesta: RECONOCIDO, T12 decidido 2027");
    expect(s.match(/Sin fila de apertura: el referente no vende esta agrupación\./g)).toHaveLength(4);
  });

  it("el pie suma «Tiendas nuevas» y «Total línea»", () => {
    const s = tabla();
    expect(s).toContain("Tiendas nuevas");
    expect(s).toContain("Total línea");
    for (const n of ["4,797", "484", "50,001", "53,208"]) expect(s).toContain(n);
  });

  it("con la proyección cerrada o bloqueada ningún campo de la apertura queda habilitado", () => {
    const solo = tabla({ bloqueada: true, secciones: secciones.filter((x) => x.codigo === "T12") });
    const campos = [...solo.matchAll(/<input[^>]*aria-label="[^"]*T12 decidido 2027"[^>]*>/g)].map((m) => m[0]);
    expect(campos).toHaveLength(3);
    for (const c of campos) expect(c).toContain("disabled");
  });

  it("sin tiendas nuevas no hay sección ni filas de pie de apertura", () => {
    const s = tabla({ secciones: [] });
    expect(s).not.toContain("Total línea");
    expect(s).not.toContain("Aperturas 2027");
  });

  it("la celda de una fila escalada se ve en gris con su título y se puede fijar; la fijada lleva ✓ y ↺", () => {
    const props = { anio: 2027, anioEnCurso: Y, bloqueada: false, ocupado: false, onDecidir: sinAsync, etiqueta: "PREMIUM, T12 decidido 2027", filaDeTienda: true };
    const escalada = html(createElement(CeldaDecision, { ...props, registro: registro(2027, { bloque: "nuevas", decidido: 64, origen: "escalada", propuesto: 70, vigente: 64 }) }));
    expect(escalada).toContain("Escalada desde el total de la tienda");
    expect(escalada).toContain("text-tinta-suave");
    expect(escalada).toContain("Aceptar la propuesta: PREMIUM");
    const fijada = html(createElement(CeldaDecision, { ...props, registro: registro(2027, { bloque: "nuevas", decidido: 64, origen: "manual", propuesto: 70, vigente: 64 }) }));
    expect(fijada).toContain('aria-label="Decidido"');
    expect(fijada).toContain("Dejar de fijar");
    expect(fijada).not.toContain("Aceptar la propuesta:");
  });

  it("al aceptar con ✓ el título dice a cuánto pasa el total de la tienda", () => {
    const props = { anio: 2027, anioEnCurso: Y, bloqueada: false, ocupado: false, onDecidir: sinAsync, etiqueta: "RECONOCIDO, T12", filaDeTienda: true, notaCambio: (n: number | null) => notaMoverTienda({ vigenteFila: 300, nueva: n, total: { propuesto: 7840, decidido: 7840 } }) };
    const s = html(createElement(CeldaDecision, { ...props, registro: registro(2027, { bloque: "nuevas", propuesto: 350, vigente: 300, decidido: null, origen: null }) }));
    expect(s).toContain("el total de la tienda pasa a 7,890.");
  });
});

describe("render del gráfico de marcas", () => {
  const l = respuestaLineas();
  const secciones = seccionesApertura(l, [Y, Y + 1], nombres());
  const grafico = (extra: Partial<Parameters<typeof GraficoMarcas>[0]> = {}) => html(createElement(GraficoMarcas, { base: l.filas, marcas: l.marcas, secciones, anios: [Y, Y + 1], ...extra }));

  it("una barra por agrupación con las marcas, «Otras (N)» y su %, y el pie del periodo", () => {
    const s = grafico();
    for (const t of ["MARCA A", "MARCA B", "MARCA C", "Otras (6)", "40.0 %", "25.0 %", "20.0 %", "MARCA I", "70.0 %"]) expect(s).toContain(t);
    expect(s).toContain("Unidades de los últimos 12 meses de las mismas tiendas (2025-10 a 2026-09, 9 tiendas), sin normalizar por el Niño.");
    expect(s.match(/<svg/g)).toHaveLength(4);
    expect(s).toContain('role="img"');
    expect(s).toContain(TEXTO_SIN_DATOS_MARCA);
  });

  it("la tabla alternativa trae el reparto de la apertura y sus unidades suman la cifra de la fila", () => {
    const s = grafico();
    expect(s).toContain("Reparto de la apertura por marca");
    expect(s).toContain("MARCA A 120 · MARCA B 75 · MARCA C 45 · otras 60");
    expect(s).toContain("MARCA I 348 · MARCA J 149");
    expect(s).toContain("Sin fila de apertura");
  });

  it("sin tiendas nuevas el gráfico se muestra igual y la tabla lo dice", () => {
    const s = grafico({ secciones: [] });
    expect(s).toContain("Sin tiendas nuevas en 2026.");
    expect(s).toContain("Sin tiendas nuevas en 2027.");
    expect(s).toContain("MARCA A");
  });

  it("la línea sin composición por marca muestra «sin datos» en todas las barras", () => {
    const s = grafico({ marcas: [] });
    expect(s.match(/Sin datos de marca en los últimos 12 meses/g)).toHaveLength(5);
    expect(s).not.toContain("<svg");
  });
});

describe("render de la tarjeta de la tienda con filas fijadas", () => {
  const props = { proyeccion: proyeccion(), perfiles: [], bloqueada: false, abierta: true, onAlternar: noop, onAtajo: noop, onCambio: sinVoid, onRecalcular: noop };

  it("dice cuántas filas hay fijadas, la suma de filas y ofrece «Usar la suma de filas»; aceptar avisa que re-escala las no fijadas", () => {
    const s = html(createElement(TarjetaTienda, { ...props, t: tiendaProyeccion({ filas_fijadas: 2, suma_filas: 7940, decidido: 7840, origen: "manual", vigente: 7840 }) }));
    expect(s).toContain("2 filas fijadas a mano (también desde Por línea) · suma de filas 7,940");
    expect(s).toContain("Usar la suma de filas");
    expect(s).toContain("Aceptar la propuesta re-escala las filas no fijadas");
  });

  it("sin filas fijadas no aparece el botón; con la proyección cerrada no hay acciones", () => {
    const sin = html(createElement(TarjetaTienda, { ...props, t: tiendaProyeccion({ filas_fijadas: 0 }) }));
    expect(sin).not.toContain("Usar la suma de filas");
    const cerrada = html(createElement(TarjetaTienda, { ...props, bloqueada: true, t: tiendaProyeccion({ filas_fijadas: 2, suma_filas: 7940 }) }));
    expect(cerrada).not.toContain("Usar la suma de filas");
    expect(cerrada).toContain("2 filas fijadas a mano");
  });
});

describe("estructura de la pantalla de la apertura en la línea", () => {
  const RAIZ = path.resolve(__dirname, "..");
  const DIR = "src/app/(app)/planificacion/proyeccion/";
  const fuente = (f: string) => readFileSync(path.join(RAIZ, DIR, f), "utf8");

  it("no hay modal ni pregunta al mover una fila ni campo `ajuste_tienda`: solo se mueve lo modificado", () => {
    for (const f of ["tabla-filas.tsx", "celda-decision.tsx", "linea-tab.tsx", "tarjeta-tienda.tsx", "grafico-marcas.tsx"]) {
      const c = fuente(f);
      expect(c, f).not.toContain("ajuste_tienda");
      expect(c, f).not.toMatch(/Mantener el total|Subir el total/);
      expect(c, f).not.toMatch(/<Modal/);
    }
  });

  it("el gráfico de marcas es un SVG propio, accesible, con tokens del tema y sin colores sueltos", () => {
    const g = fuente("grafico-marcas.tsx");
    expect(g).toContain("<svg");
    expect(g).toContain('role="img"');
    expect(g).toContain("<figcaption");
    expect(g).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgb\(|hsl\(/);
    expect(fuente("linea-tab.tsx")).toContain("<GraficoMarcas");
  });

  it("al guardar una fila de apertura la pantalla muestra el total de la tienda ya actualizado", () => {
    expect(fuente("linea-tab.tsx")).toContain("textoTotalTiendaTras");
    expect(fuente("tarjeta-tienda.tsx")).toContain("textoTotalTiendaTras");
  });
});
