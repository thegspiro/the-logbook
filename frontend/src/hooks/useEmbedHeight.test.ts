import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { EMBED_HEIGHT_MESSAGE, useEmbedHeight } from './useEmbedHeight';

describe('useEmbedHeight', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const frameInParent = () => {
    const postMessage = vi.fn();
    vi.spyOn(window, 'parent', 'get').mockReturnValue({ postMessage } as unknown as Window);
    return postMessage;
  };

  it('tells the host page its height when framed', () => {
    const postMessage = frameInParent();
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(812.4);

    renderHook(() => useEmbedHeight(true, 'abc123def456'));

    expect(postMessage).toHaveBeenCalledWith({ type: EMBED_HEIGHT_MESSAGE, slug: 'abc123def456', height: 813 }, '*');
  });

  it('says nothing on the standalone page', () => {
    const postMessage = frameInParent();

    renderHook(() => useEmbedHeight(false, 'abc123def456'));

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('says nothing when not framed at all', () => {
    const postMessage = vi.spyOn(window, 'postMessage');

    renderHook(() => useEmbedHeight(true, 'abc123def456'));

    expect(postMessage).not.toHaveBeenCalled();
  });
});
