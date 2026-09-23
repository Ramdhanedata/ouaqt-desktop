/*
 * The key that proves a licence file came from us.
 *
 * Public by design: it can check a signature and cannot make one. It is the
 * key of the **test** project, ouaqt-builder-test, which is right for the
 * test version and wrong for anything an owner installs. A production build
 * replaces it with the production project's public key; that is on the
 * launch checklist, because a real shop's licence would not verify against
 * this one and the app would, correctly, refuse to open.
 */
export const LICENCE_PUBLIC_KEY =
  "MCowBQYDK2VwAyEAW2WorHmYArB_SEFOam-RxgYn_EDwjuV9lH-8531w6aU";

/** Which project this build trusts, shown in the test banner. */
export const LICENCE_KEY_LABEL = "test";
