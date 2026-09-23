/*
 * The database, as one import.
 *
 * Bundled to dist/main/db.js so that the checks in scripts/check-db.mjs can
 * exercise the real modules rather than a copy of their SQL. A test that
 * rewrites the query it is testing proves nothing.
 */
export { openDatabase, migrate, readMigrations, integrityIsGood } from "./open";
export { deviceIdOf, stamp, getSetting, setSetting } from "./rows";
export { audit, recentAudit } from "./audit";
export * from "./products";
export * from "./sales";
export * from "./customers";
export * from "./cash";
export * from "./cashbook";
export * from "./reports";
export * from "./restaurant";
export * from "./bakery";
export * from "./warehouse";
export * from "./hotel";
export * from "./transport";
export * from "./clock";
