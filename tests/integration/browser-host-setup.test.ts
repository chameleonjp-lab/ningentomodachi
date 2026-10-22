// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { createBrowserHost } from '../../src/app/bootstrap';
test('browser lifecycle listener failure removes listeners acquired before initial visibility delivery', () => {
  const listener = vi.fn(() => {
    throw new Error('listener failed');
  });
  const removeWindow = vi.spyOn(window, 'removeEventListener'),
    removeDocument = vi.spyOn(document, 'removeEventListener');
  try {
    expect(() =>
      createBrowserHost(window, document).subscribe(listener),
    ).toThrow('listener failed');
    expect(removeWindow.mock.calls.map((call) => call[0])).toEqual([
      'blur',
      'pagehide',
      'pageshow',
    ]);
    expect(removeDocument.mock.calls.map((call) => call[0])).toEqual([
      'visibilitychange',
    ]);
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(listener).toHaveBeenCalledOnce();
  } finally {
    removeWindow.mockRestore();
    removeDocument.mockRestore();
  }
});
