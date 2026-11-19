import { describe, expect, it } from 'vitest';
import { copyText } from './clipboard';

describe('copyText', () => {
  it('writes the exact text through the clipboard API', async () => {
    const written: string[] = [];
    const ok = await copyText('# Title\n\n- item', {
      writeText: async (text) => void written.push(text),
    });
    expect(ok).toBe(true);
    expect(written).toEqual(['# Title\n\n- item']);
  });

  it('reports failure when there is no clipboard and no document', async () => {
    const ok = await copyText('x', {
      writeText: async () => {
        throw new Error('denied');
      },
    });
    expect(ok).toBe(false);
  });
});
