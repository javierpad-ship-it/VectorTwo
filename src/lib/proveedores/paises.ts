/**
 * Países admitidos en la ficha del proveedor (08c, §2.1). Nombres en español, como `countries.ts` de COTV, más los de Asia que
 * faltaban. `pais` sigue siendo texto en la base: la API valida TODA escritura contra esta lista.
 */
export const PAIS_EEUU = "Estados Unidos";

export const PAISES = [
  "Argentina",
  "Bolivia",
  "Brasil",
  "Chile",
  "Colombia",
  "Costa Rica",
  "Cuba",
  "Ecuador",
  "El Salvador",
  PAIS_EEUU,
  "Guatemala",
  "Honduras",
  "México",
  "Nicaragua",
  "Panamá",
  "Paraguay",
  "Perú",
  "Puerto Rico",
  "República Dominicana",
  "Uruguay",
  "Venezuela",
  "Canadá",
  "España",
  "Portugal",
  "Francia",
  "Italia",
  "Alemania",
  "Reino Unido",
  "Países Bajos",
  "Bélgica",
  "Suiza",
  "China",
  "India",
  "Indonesia",
  "Vietnam",
  "Bangladés",
  "Camboya",
  "Pakistán",
  "Turquía",
  "Corea del Sur",
  "Japón",
  "Taiwán",
  "Hong Kong",
  "Tailandia",
  "Filipinas",
  "Malasia",
  "Singapur",
  "Sri Lanka",
  "Birmania",
  "Laos",
  "Nepal",
  "Emiratos Árabes Unidos",
  "Australia",
  "Nueva Zelanda",
  "Sudáfrica",
  "Otro",
] as const;

export type Pais = (typeof PAISES)[number];

const SET_PAISES: ReadonlySet<string> = new Set(PAISES);
export const esPais = (valor: string): valor is Pais => SET_PAISES.has(valor);
