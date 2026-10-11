import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  cortarEnFilaCompleta,
  crearProyector,
  detectarCodificacion,
  detectarSeparador,
  leerCabecera,
  leerPorBloques,
  type BloqueFilas,
} from "@/lib/ventas/leer-por-bloques";
import { detectarMapeo } from "@/components/importador/mapeo";
import { CAMPOS_ARCHIVO_VENTA, ENCABEZADOS_QLIKVIEW } from "@/lib/ventas/columnas";
import { CAMPOS_VENTA } from "@/lib/ventas/tipos";

const BOM = "﻿";
const cabecera = ENCABEZADOS_QLIKVIEW.join(",");
const filaCsv = (i: number, extra = "") =>
  `2026,Set,LUKERS UNO,HOMBRE,CASUAL,DENIM,PANTALON VARIOS,MARCA ${i},Central,${i},${i * 10},${i * 4},${i * 2},${i * 8}${extra}`;

function archivoUtf8(texto: string, nombre = "ventas.csv"): File {
  return new File([new TextEncoder().encode(texto)], nombre);
}

async function leer(archivo: File, opciones: Partial<Parameters<typeof leerPorBloques>[1]> = {}) {
  const bloques: BloqueFilas[] = [];
  const resultado = await leerPorBloques(archivo, { alBloque: (b) => void bloques.push(b), ...opciones });
  return { bloques, resultado, filas: bloques.flatMap((b) => b.filas) };
}

describe("detección de codificación y separador", () => {
  it("UTF-8 con BOM, UTF-8 sin BOM y Windows-1252", async () => {
    expect(await detectarCodificacion(archivoUtf8(`${BOM}A,B\nÑ,1\n`))).toEqual({ codificacion: "utf-8", conBom: true, etiqueta: "UTF-8 con BOM" });
    expect((await detectarCodificacion(archivoUtf8("A,B\nÑ,1\n"))).etiqueta).toBe("UTF-8");
    const ansi = new File([new Uint8Array([0x4e, 0x49, 0xd1, 0x41, 0x53, 0x0a])], "ansi.csv"); // NIÑAS en Windows-1252
    expect(await detectarCodificacion(ansi)).toMatchObject({ codificacion: "windows-1252", conBom: false });
  });

  it("detecta coma, punto y coma, tabulador y barra", () => {
    expect(detectarSeparador("a,b,c\n1,2,3\n")).toBe(",");
    expect(detectarSeparador("a;b;c\n1;2;3\n")).toBe(";");
    expect(detectarSeparador("a\tb\tc\n1\t2\t3\n")).toBe("\t");
    expect(detectarSeparador("a|b|c\n1|2|3\n")).toBe("|");
  });
});

describe("leerPorBloques: CSV", () => {
  it("lee el CSV real (UTF-8 con BOM, coma): tildes y Ñ correctas y cabecera sin BOM", async () => {
    const texto = `${BOM}${cabecera}\n2026,Set,NIÑAS CENTRO,MUJER,CASUAL,DENIM,,MARCA Ñ,Central,1,2,3,4,5\n`;
    const { filas, resultado, bloques } = await leer(archivoUtf8(texto));
    expect(resultado).toMatchObject({ separador: ",", codificacion: "utf-8", filas: 1, cancelado: false, hoja: null });
    expect(resultado.columnas).toEqual([...ENCABEZADOS_QLIKVIEW]);
    expect(bloques[0].columnas[0]).toBe("AÑO");
    expect(filas[0][2]).toBe("NIÑAS CENTRO");
    expect(filas[0][7]).toBe("MARCA Ñ");
  });

  it("un bloque pequeño da exactamente las mismas filas, en orden, y numera desde 1", async () => {
    const cuerpo = Array.from({ length: 500 }, (_, i) => filaCsv(i + 1)).join("\n");
    const archivo = archivoUtf8(`${BOM}${cabecera}\n${cuerpo}\n`);
    const entero = await leer(archivo);
    const partido = await leer(archivo, { bytesBloque: 211 });
    expect(partido.bloques.length).toBeGreaterThan(10);
    expect(partido.filas).toEqual(entero.filas);
    expect(partido.filas).toHaveLength(500);
    expect(partido.bloques.map((b) => b.primeraFila)[0]).toBe(1);
    let esperada = 1;
    for (const b of partido.bloques) {
      expect(b.primeraFila).toBe(esperada);
      esperada += b.filas.length;
    }
  });

  it("una fila con saltos de línea entre comillas no se parte entre bloques", async () => {
    const texto = `${cabecera}\n${filaCsv(1, "")}\n2026,Set,"LOCAL\nCON SALTO",H,C,D,E,M,Central,1,2,3,4,5\n${filaCsv(3)}\n`;
    for (const bytesBloque of [7, 40, 97, 160, 10_000]) {
      const { filas } = await leer(archivoUtf8(texto), { bytesBloque });
      expect(filas, `bloque ${bytesBloque}`).toHaveLength(3);
      expect(filas[1][2]).toBe("LOCAL\nCON SALTO");
    }
  });

  it("un carácter de varios bytes partido entre dos bloques no se rompe", async () => {
    const texto = `${cabecera}\n${filaCsv(1).replace("LUKERS UNO", "NIÑÑÑÑÑÑÑÑÑS")}\n`;
    for (let bytesBloque = 5; bytesBloque < 40; bytesBloque++) {
      const { filas } = await leer(archivoUtf8(texto), { bytesBloque });
      expect(filas[0][2], `bloque ${bytesBloque}`).toBe("NIÑÑÑÑÑÑÑÑÑS");
    }
  });

  it("lee Windows-1252 cuando no es UTF-8 y respeta la codificación elegida", async () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("TIENDA,MARCA\nLOCAL "), 0xd1, ...new TextEncoder().encode(",X\n")]);
    const { filas, resultado } = await leer(new File([bytes], "a.csv"));
    expect(resultado.codificacion).toBe("windows-1252");
    expect(filas[0][0]).toBe("LOCAL Ñ");
    const forzada = await leer(new File([bytes], "a.csv"), { codificacion: "utf-8" });
    expect(forzada.filas[0][0]).toContain("�");
  });

  it("separador punto y coma, filas vacías descartadas, archivo sin salto final", async () => {
    const { filas, resultado } = await leer(archivoUtf8("A;B\n1;2\n\n;\n3;4"));
    expect(resultado.separador).toBe(";");
    expect(filas).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("informa el progreso y se puede cancelar", async () => {
    const cuerpo = Array.from({ length: 300 }, (_, i) => filaCsv(i + 1)).join("\n");
    const archivo = archivoUtf8(`${cabecera}\n${cuerpo}\n`);
    const fracciones: number[] = [];
    await leer(archivo, { bytesBloque: 500, alProgreso: (p) => void fracciones.push(p.fraccion) });
    expect(fracciones.length).toBeGreaterThan(5);
    expect(fracciones[fracciones.length - 1]).toBe(1);
    expect([...fracciones].sort((a, b) => a - b)).toEqual(fracciones);

    const control = new AbortController();
    let recibidos = 0;
    const r = await leerPorBloques(archivo, {
      bytesBloque: 500,
      signal: control.signal,
      alBloque: (b) => {
        recibidos += b.filas.length;
        control.abort();
      },
    });
    expect(r.cancelado).toBe(true);
    expect(recibidos).toBeLessThan(300);
  });

  it("un archivo vacío lanza un error legible", async () => {
    await expect(leerPorBloques(archivoUtf8(""), { alBloque: () => undefined })).rejects.toThrow(/vacío/);
  });

  it("cortarEnFilaCompleta respeta las comillas", () => {
    expect(cortarEnFilaCompleta("a,b\nc,d")).toEqual(["a,b\n", "c,d"]);
    expect(cortarEnFilaCompleta('a,"x\ny')).toEqual(["", 'a,"x\ny']);
    expect(cortarEnFilaCompleta('a,"x\ny"\nc')).toEqual(['a,"x\ny"\n', "c"]);
    expect(cortarEnFilaCompleta("sin salto")).toEqual(["", "sin salto"]);
  });

  it("una comilla suelta no hace cuadrático el corte ni deja crecer la memoria sin límite", async () => {
    // 300 000 renglones con una sola comilla al principio: antes eran n² pasadas.
    const texto = `a,"b\n${"1,2,3\n".repeat(300_000)}`;
    const inicio = performance.now();
    expect(cortarEnFilaCompleta(texto)).toEqual(["", texto]);
    expect(performance.now() - inicio).toBeLessThan(1_000);

    const archivo = archivoUtf8(`${cabecera}\n2026,Set,"LOCAL SIN CERRAR,H\n${"1,2,3\n".repeat(5_000)}`);
    await expect(leerPorBloques(archivo, { bytesBloque: 1_000, maxFila: 8_000, alBloque: () => undefined })).rejects.toThrow(/comilla/);
  });

  it("el tope no afecta a un archivo con filas normales", async () => {
    const cuerpo = Array.from({ length: 200 }, (_, i) => filaCsv(i + 1)).join("\n");
    const { filas } = await leer(archivoUtf8(`${cabecera}\n${cuerpo}\n`), { bytesBloque: 300, maxFila: 2_000 });
    expect(filas).toHaveLength(200);
  });
});

describe("leerCabecera y crearProyector", () => {
  it("lee cabecera y muestra y el mapeo detecta los 14 campos", async () => {
    const texto = `${BOM}${cabecera}\n${filaCsv(1)}\n${filaCsv(2)}\n`;
    const c = await leerCabecera(archivoUtf8(texto));
    expect(c).toMatchObject({ separador: ",", codificacion: "utf-8", hoja: null });
    expect(c.columnas).toHaveLength(14);
    expect(c.muestra).toHaveLength(2);
    const mapeo = detectarMapeo(c.columnas, CAMPOS_ARCHIVO_VENTA);
    const fila = crearProyector(c.columnas, mapeo)(c.muestra[0]);
    expect(fila).toMatchObject({ anio: "2026", mes: "Set", tienda: "LUKERS UNO", marca: "MARCA 1", talla: "Central", stock_unidades: "1", unidades: "10", venta_soles: "4", costo_vendido: "2", stock_valorizado: "8" });
    for (const campo of CAMPOS_VENTA) expect(typeof fila[campo]).toBe("string");
  });

  it("un campo sin columna viaja como cadena vacía", () => {
    const mapeo = detectarMapeo(["MES", "TIENDA"], CAMPOS_ARCHIVO_VENTA);
    const fila = crearProyector(["MES", "TIENDA"], mapeo)(["Set", "T1"]);
    expect(fila.mes).toBe("Set");
    expect(fila.marca).toBe("");
  });
});

describe("leerPorBloques: Excel (secundario)", () => {
  function libro(filas: unknown[][], formatoAnio?: string, nombre = "ventas.xlsx"): File {
    const hoja = XLSX.utils.aoa_to_sheet(filas);
    if (formatoAnio) hoja.A2.z = formatoAnio;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, hoja, "Hoja1");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["otra"]]), "Otra");
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    return new File([bytes], nombre);
  }

  it("lee valores numéricos crudos: el año con formato #,##0 no sale como 2,026 y los decimales ocultos no se pierden", async () => {
    const archivo = libro(
      [
        ["AÑO", "MES", "Vta S/"],
        [2026, "Set", 205.70999999999998],
        [2026, 9, 0.00001],
      ],
      "#,##0"
    );
    const { filas, resultado } = await leer(archivo);
    expect(filas).toEqual([
      ["2026", "Set", "205.70999999999998"],
      ["2026", "9", "0.00001"],
    ]);
    expect(resultado).toMatchObject({ hoja: "Hoja1", hojas: ["Hoja1", "Otra"], filasHoja: 3, posiblementeTruncado: false, cancelado: false });
  });

  it("entrega la hoja pedida y la cabecera de la muestra", async () => {
    const archivo = libro([["A", "B"], ["1", "2"]]);
    const c = await leerCabecera(archivo, { hoja: "Otra" });
    expect(c).toMatchObject({ hoja: "Otra", hojas: ["Hoja1", "Otra"], columnas: ["otra"] });
    const base = await leerCabecera(archivo);
    expect(base).toMatchObject({ hoja: "Hoja1", columnas: ["A", "B"], filasHoja: 2 });
    expect(base.muestra).toEqual([["1", "2"]]);
  });

  it("parte la hoja en bloques sin perder ni repetir filas", async () => {
    const filas: unknown[][] = [["N", "V"], ...Array.from({ length: 45_000 }, (_, i) => [i + 1, i * 2])];
    const { bloques, filas: leidas } = await leer(libro(filas));
    expect(bloques.length).toBe(3);
    expect(leidas).toHaveLength(45_000);
    expect(leidas[0]).toEqual(["1", "0"]);
    expect(leidas[44_999]).toEqual(["45000", "89998"]);
    expect(bloques.map((b) => b.primeraFila)).toEqual([1, 20_000, 40_000]);
  }, 60_000);
});
