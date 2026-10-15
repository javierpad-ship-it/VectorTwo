/**
 * Entrada pública del modelo de M7 (ficha 07, reglas 40 a 42): `calcularProyeccion` (determinista, lee la venta una
 * vez), `aplicarDecision`, `aplicarDecisionTienda`, `recalcularBaseSiguiente` y `aplicarCurvaNueva` (corren sobre lo
 * guardado, sin releer venta).
 */
export { calcularProyeccion } from "./calculo";
export {
  aplicarCurvaNueva,
  aplicarDecision,
  aplicarDecisionTienda,
  armarRegistro,
  recalcularBaseSiguiente,
  recalcularFilasTienda,
  registroDe,
  textoCambioCurva,
  type ContextoModelo,
  type DecisionEntrada,
  type InfoTienda,
} from "./decision";
