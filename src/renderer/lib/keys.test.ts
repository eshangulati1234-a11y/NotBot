import { describe, expect, it } from 'vitest';
import { deviceName, isEditable, isMac, isMod, modKey } from './keys';

describe('keys', () => {
  it('uses the platform modifier', () => {
    expect(modKey).toBe(isMac ? '\u2318' : 'Ctrl');
    expect(isMod({ metaKey: true, ctrlKey: false })).toBe(isMac);
    expect(isMod({ metaKey: false, ctrlKey: true })).toBe(!isMac);
    expect(isMod({ metaKey: false, ctrlKey: false })).toBe(false);
  });
  it('names the device by platform', () => {
    expect(deviceName).toBe(isMac ? 'this Mac' : 'this computer');
  });
  it('recognises editable targets without a DOM', () => {
    expect(isEditable(null)).toBe(false);
    expect(isEditable({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isEditable({ tagName: 'input' } as unknown as EventTarget)).toBe(true);
    expect(isEditable({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isEditable({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
  });
});
