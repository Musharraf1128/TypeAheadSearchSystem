import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Custom debounce hook. Returns the debounced value after the specified delay.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Click-outside detector for closing dropdowns.
 */
export function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  handler: () => void,
) {
  useEffect(() => {
    const listener = (e: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      handler();
    };
    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);
    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref, handler]);
}

/**
 * Keyboard shortcut hook — focuses the input on "/" press.
 */
export function useSlashFocus(inputRef: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [inputRef]);
}

/**
 * Toast auto-dismiss hook.
 */
export function useToast(duration = 3500) {
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((title: string, message: string) => {
    setExiting(false);
    setToast({ title, message });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setExiting(true);
      setTimeout(() => setToast(null), 300);
    }, duration);
  }, [duration]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return { toast, exiting, showToast };
}
