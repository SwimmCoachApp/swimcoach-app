import { lockPage } from '../../src/app/native-feel.js';

describe('page verrouillée comme une app native', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('le pincement (gestes iPhone) est bloqué', () => {
    lockPage(document);
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      const ev = new Event(type, { cancelable: true, bubbles: true });
      document.body.dispatchEvent(ev);
      expect(ev.defaultPrevented, type).toBe(true);
    }
  });

  test('appelé deux fois, il ne s’installe qu’une fois par document', () => {
    const target = document.implementation.createHTMLDocument('x');
    const spy = vi.spyOn(target, 'addEventListener');
    lockPage(target);
    const n = spy.mock.calls.length;
    lockPage(target);
    expect(spy.mock.calls.length).toBe(n);
  });
});
