/*
 * The database, as one import.
 *
 * Bundled to dist/main/db.js so that the checks in scripts/check-db.mjs can
 * exercise the real modules rather than a copy of their SQL. A test that
 * rewrites the query it is testing proves nothing.
 */
export { openDatabase, migrate, readMigrations, integrityIsGood } from "./open";
export { deviceIdOf, stamp, getSetting, setSetting } from "./rows";
export {
  addProduct,
  listProducts,
  searchProducts,
  recordMovement,
  onHand,
  type Product,
  type NewProduct,
} from "./products";
export {
  recordSale,
  voidSale,
  recentSales,
  cashTakenSince,
  type NewSale,
  type SaleLine,
  type RecordedSale,
} from "./sales";
