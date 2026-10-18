import { describe, expect, it } from "vitest";
import { celdasRegla, COLUMNAS_REGLAS, filtrosTexto, hojasReglas } from "../src/app/(app)/maestros/intercompany/excel-vista";
import { filtrarReglas, filtrosEfectivos, indiceNodos, nodosDelArbol, PARAMETROS_VACIOS } from "../src/app/(app)/maestros/intercompany/vista";
import { arbolEjemplo, IDS, reglasEjemplo } from "./intercompany.pantalla.fixture";

/** El Excel es la tabla (ficha 13, regla 10): mismas columnas, mismas filas y el filtro escrito con nombres. */

const nodos = nodosDelArbol(arbolEjemplo());
const marcas = [
  { id: IDS.jh, nombre: "JH" },
  { id: IDS.vanHeusen, nombre: "VAN HEUSEN" },
];

describe("Excel de las reglas", () => {
  it("la hoja REGLAS lleva las columnas de la tabla y una fila por regla visible", () => {
    const parametros = PARAMETROS_VACIOS;
    const visibles = filtrarReglas(reglasEjemplo(), filtrosEfectivos(parametros, nodos), indiceNodos(nodos));
    const hojas = hojasReglas(visibles, filtrosTexto(parametros, "2026-10", nodos, marcas));
    expect(Object.keys(hojas)).toEqual(["REGLAS", "FILTROS"]);
    expect(hojas.REGLAS[0]).toEqual(COLUMNAS_REGLAS.map((c) => c.titulo.toUpperCase()));
    expect(hojas.REGLAS).toHaveLength(visibles.length + 1);
    expect(visibles).toHaveLength(6);
  });
  it("las celdas son números donde hay números y la regla de equivalencia se señala", () => {
    const [r1, , r2, , r4, r5] = reglasEjemplo();
    expect(celdasRegla(r1)).toMatchObject({ marca: "JH", desde: "ene-2026", min: 4, max: 8, directo: 80, del_cd: 20, observado: null, aplicable: "Sí" });
    expect(celdasRegla(r2).ruta).toContain("MANGA CORTA");
    expect(celdasRegla(r2).ruta).toContain("manda sobre el GML");
    expect(celdasRegla(r4).aplicable).toBe("No: sin clave");
    expect(celdasRegla(r5).aplicable).toBe("Sin evaluar");
  });
  it("la hoja FILTROS dice con nombres qué se filtró: mes, ámbito sugerido, solo y cantidad", () => {
    const f = filtrosTexto({ ...PARAMETROS_VACIOS, marca: IDS.jh, solo: ["no_aplicables"] }, "2026-10", nodos, marcas);
    expect(f).toMatchObject({ mes: "2026-10", marca: "JH", linea: "Todas" });
    expect(f.genero).toContain("HOMBRE");
    expect(f.genero).toContain("ámbito sugerido");
    expect(f.mundos).toContain("FORMAL");
    expect(f.mundos).toContain("RI");
    const hojas = hojasReglas([], f);
    const texto = JSON.stringify(hojas.FILTROS);
    expect(texto).toContain("oct-2026");
    expect(texto).toContain("No aplicables");
    expect(texto).toContain("4–8");
    expect(hojas.FILTROS.at(-1)).toEqual(["Reglas en la hoja", 0]);
  });
  it("sin ámbito (todos) lo dice", () => {
    const f = filtrosTexto({ ...PARAMETROS_VACIOS, genero: { tipo: "todos" }, mundo: { tipo: "todos" } }, "2026-10", nodos, marcas);
    expect(f.genero).toBe("Todos");
    expect(f.mundos).toBe("Todos");
  });
});
