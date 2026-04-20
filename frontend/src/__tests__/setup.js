/**
 * Vitest global setup file.
 * Imported once before any test suite via vite.config.js → test.setupFiles.
 *
 * 1. Extends expect() with @testing-library/jest-dom matchers
 * 2. Polyfills jsdom gaps used by App.jsx:
 *    - Element.prototype.scrollIntoView  (chatEndRef scroll)
 *    - window.requestAnimationFrame      (viseme animation loop)
 *    - window.cancelAnimationFrame
 */
import '@testing-library/jest-dom';

// scrollIntoView is not implemented in jsdom
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// rAF stubs — jsdom provides them but some older versions don't
if (typeof window !== 'undefined') {
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb) => setTimeout(cb, 16);
  }
  if (!window.cancelAnimationFrame) {
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  }
}
