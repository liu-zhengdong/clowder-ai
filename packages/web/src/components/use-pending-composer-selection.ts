'use client';

import { type MutableRefObject, type RefObject, useLayoutEffect } from 'react';

export interface PendingComposerSelection {
  text: string;
  start: number;
  end: number;
  direction?: 'forward' | 'backward' | 'none';
  focus?: boolean;
}

export function usePendingComposerSelection(
  input: string,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  pendingSelectionRef: MutableRefObject<PendingComposerSelection | null>,
  contextAttachmentCount: number,
): void {
  useLayoutEffect(() => {
    // Attachment-only inserts can leave `input` unchanged. The count provides
    // the commit boundary needed to apply their pending focus intent.
    void contextAttachmentCount;
    const selection = pendingSelectionRef.current;
    const textarea = textareaRef.current;
    if (!selection || !textarea || textarea.value !== selection.text || input !== selection.text) return;
    const applySelection = () => {
      const current = textareaRef.current;
      if (!current) return;
      if (current.value !== selection.text) return;
      if (selection.focus !== false) current.focus();
      current.setSelectionRange(selection.start, selection.end, selection.direction);
    };
    applySelection();
    pendingSelectionRef.current = null;
    if (selection.focus === false) return;
    const timer = window.setTimeout(applySelection, 0);
    return () => window.clearTimeout(timer);
  }, [contextAttachmentCount, input, pendingSelectionRef, textareaRef]);
}
