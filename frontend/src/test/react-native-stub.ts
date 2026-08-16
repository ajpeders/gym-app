/**
 * Stand-in for `react-native` in the unit tests.
 *
 * vitest runs on Node and can't parse React Native's Flow-typed entrypoint.
 * The modules under test only reach for `Platform` to decide between the web
 * and device code paths, so the stub answers that and nothing else — anything
 * needing more of React Native belongs in the Playwright suite, which runs the
 * real build.
 */
export const Platform = { OS: 'web' as const, select: <T,>(spec: { web?: T; default?: T }) => spec.web ?? spec.default };
