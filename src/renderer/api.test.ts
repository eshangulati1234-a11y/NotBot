import { describe, expect, it } from 'vitest';
import { folderName, friendlyError, messageText } from './api';

describe('friendlyError', () => {
  it('strips Electron IPC prefixes and settings clauses', () => {
    expect(
      friendlyError(new Error("Error invoking remote method 'runtime:request': Error: Model server unavailable. Retry startup in Settings.")),
    ).toBe('Model server unavailable.');
    expect(friendlyError('Error: Could not start Notbot - Retry startup in Settings')).toBe('Could not start Notbot');
    expect(friendlyError('Something broke')).toBe('Something broke');
    expect(friendlyError('Retry startup in Settings')).not.toMatch(/Settings/);
  });
});

describe('messageText and folderName', () => {
  it('reads string and part content', () => {
    expect(messageText({ type: 'ai', data: { content: 'hi' } })).toBe('hi');
    expect(messageText({ type: 'ai', data: { content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] } })).toBe('ab');
  });
  it('takes the last path segment', () => {
    expect(folderName('/a/b/docs/')).toBe('docs');
    expect(folderName('C:\\x\\y')).toBe('y');
  });
});
