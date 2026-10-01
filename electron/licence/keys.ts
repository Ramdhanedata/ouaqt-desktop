/*
 * The key that proves a licence file came from us.
 *
 * Public by design: it can check a signature and cannot make one. A test
 * build trusts the test project, ouaqt-builder-test; a production build
 * (OUAQT_RELEASE=production, see scripts/build-main.mjs) trusts the
 * production project, whose private half signs licences on www.ouaqt.com.
 * A licence from one never verifies on the other, and the app, correctly,
 * refuses to open on it.
 */
declare const __OUAQT_TEST_BUILD__: boolean;
const TEST_BUILD = typeof __OUAQT_TEST_BUILD__ === "boolean" ? __OUAQT_TEST_BUILD__ : true;

/* ouaqt-builder-test: what a test build and the checks trust. */
const TEST_KEY = "MCowBQYDK2VwAyEAW2WorHmYArB_SEFOam-RxgYn_EDwjuV9lH-8531w6aU";
/* ouaqt-production, made 2026-10-01: what an owner's installed copy trusts. */
const PRODUCTION_KEY = "MCowBQYDK2VwAyEAWZLsnFgB6YC79Wm94j-F316IRws5LRtEyOoWJ5vlXfs";

export const LICENCE_PUBLIC_KEY = TEST_BUILD ? TEST_KEY : PRODUCTION_KEY;

/** Which project this build trusts, shown in the test banner. */
export const LICENCE_KEY_LABEL = TEST_BUILD ? "test" : "production";
