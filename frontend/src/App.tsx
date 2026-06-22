import { useState, useEffect, useRef, useCallback } from 'react';
import type { Suggestion } from './types';
import { fetchSuggestions, postSearch } from './api';
import { useDebounce, useClickOutside, useSlashFocus, useToast } from './hooks';
import Dropdown from './components/Dropdown';
import SearchToast from './components/SearchToast';
import { SearchIcon, XIcon, SparklesIcon, ZapIcon } from './components/Icons';

function App() {
  // ——— State ———
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [totalSearches, setTotalSearches] = useState(0);

  // ——— Refs ———
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController>();

  // ——— Hooks ———
  const debouncedQuery = useDebounce(query, 300);
  const { toast, exiting, showToast } = useToast();
  useClickOutside(containerRef, () => setIsOpen(false));
  useSlashFocus(inputRef);

  // ——— Fetch suggestions on debounced query change ———
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSuggestions([]);
      setIsOpen(false);
      setError(null);
      return;
    }

    // Abort previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);
    setIsOpen(true);

    fetchSuggestions(debouncedQuery.trim(), controller.signal)
      .then((data) => {
        setSuggestions(data.suggestions ?? []);
        setActiveIndex(-1);
        setIsOpen(true);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError('Could not load suggestions. Is the backend running?');
        setSuggestions([]);
      })
      .finally(() => {
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [debouncedQuery]);

  // ——— Execute search ———
  const executeSearch = useCallback(
    async (searchQuery: string) => {
      const trimmed = searchQuery.trim();
      if (!trimmed) return;

      setIsOpen(false);
      setQuery(trimmed);

      try {
        const data = await postSearch(trimmed);
        showToast('Search recorded', data.message || `Searched for "${trimmed}"`);
        setTotalSearches((n) => n + 1);
      } catch {
        showToast('Search sent', `Searched for "${trimmed}"`);
        setTotalSearches((n) => n + 1);
      }
    },
    [showToast],
  );

  // ——— Keyboard navigation ———
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === 'Enter') {
          executeSearch(query);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0,
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1,
          );
          break;
        case 'Enter':
          e.preventDefault();
          if (activeIndex >= 0 && activeIndex < suggestions.length) {
            executeSearch(suggestions[activeIndex].query);
          } else {
            executeSearch(query);
          }
          break;
        case 'Escape':
          setIsOpen(false);
          setActiveIndex(-1);
          break;
      }
    },
    [isOpen, activeIndex, suggestions, query, executeSearch],
  );

  // ——— Select suggestion ———
  const handleSelect = useCallback(
    (q: string) => {
      executeSearch(q);
    },
    [executeSearch],
  );

  // ——— Clear input ———
  const handleClear = useCallback(() => {
    setQuery('');
    setSuggestions([]);
    setIsOpen(false);
    setError(null);
    inputRef.current?.focus();
  }, []);

  return (
    <div className="app">
      {/* ——— Hero ——— */}
      <header className="hero">
        <div className="hero__icon">
          <SparklesIcon />
        </div>
        <h1 className="hero__title">TypeAhead Search</h1>
        <p className="hero__subtitle">
          Lightning-fast suggestions powered by Trie + LRU Cache
        </p>
      </header>

      {/* ——— Search ——— */}
      <div className="search-container" ref={containerRef}>
        <div className={`search-box ${isFocused ? 'search-box--focused' : ''}`}>
          <div className="search-box__inner">
            <span className="search-box__icon">
              <SearchIcon />
            </span>

            <input
              ref={inputRef}
              className="search-box__input"
              type="text"
              placeholder="Search anything…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => {
                setIsFocused(true);
                if (suggestions.length > 0 && query.trim()) setIsOpen(true);
              }}
              onBlur={() => setIsFocused(false)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              spellCheck={false}
              aria-label="Search"
              aria-expanded={isOpen}
              aria-autocomplete="list"
            />

            {isLoading && (
              <div className="search-box__loader">
                <div className="spinner" />
              </div>
            )}

            {query && !isLoading && (
              <button
                className="search-box__clear"
                onClick={handleClear}
                aria-label="Clear search"
                type="button"
              >
                <XIcon style={{ width: 16, height: 16 }} />
              </button>
            )}

            {!query && (
              <div className="search-box__shortcut">
                <kbd>/</kbd>
              </div>
            )}
          </div>
        </div>

        {/* ——— Dropdown ——— */}
        {isOpen && (
          <Dropdown
            suggestions={suggestions}
            prefix={debouncedQuery}
            activeIndex={activeIndex}
            isLoading={isLoading}
            error={error}
            onSelect={handleSelect}
            onHover={setActiveIndex}
          />
        )}
      </div>

      {/* ——— Stats ——— */}
      {totalSearches > 0 && (
        <div className="stats">
          <div className="stats__item">
            <div className="stats__value">{totalSearches}</div>
            <div className="stats__label">Searches</div>
          </div>
          <div className="stats__item">
            <div className="stats__value">
              <ZapIcon style={{ width: 20, height: 20, display: 'inline', verticalAlign: 'middle' }} />
            </div>
            <div className="stats__label">Trie + LRU</div>
          </div>
          <div className="stats__item">
            <div className="stats__value">300ms</div>
            <div className="stats__label">Debounce</div>
          </div>
        </div>
      )}

      {/* ——— Footer ——— */}
      <footer className="footer">
        TypeAhead Search System — Built with React + Go
      </footer>

      {/* ——— Toast ——— */}
      {toast && (
        <SearchToast
          title={toast.title}
          message={toast.message}
          exiting={exiting}
        />
      )}
    </div>
  );
}

export default App;
