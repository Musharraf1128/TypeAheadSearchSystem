import React from 'react';
import type { Suggestion } from '../types';
import SuggestionItem from './SuggestionItem';
import { InboxIcon, AlertCircleIcon } from './Icons';

interface DropdownProps {
  suggestions: Suggestion[];
  prefix: string;
  activeIndex: number;
  isLoading: boolean;
  error: string | null;
  onSelect: (query: string) => void;
  onHover: (index: number) => void;
}

const Dropdown: React.FC<DropdownProps> = ({
  suggestions,
  prefix,
  activeIndex,
  isLoading,
  error,
  onSelect,
  onHover,
}) => {
  // Error state
  if (error) {
    return (
      <div className="dropdown">
        <div className="error-state">
          <div className="error-state__icon">
            <AlertCircleIcon />
          </div>
          <div className="error-state__title">Something went wrong</div>
          <div className="error-state__text">{error}</div>
        </div>
      </div>
    );
  }

  // Loading with no results yet
  if (isLoading && suggestions.length === 0) {
    return (
      <div className="dropdown">
        <div className="empty-state">
          <div className="empty-state__icon">
            <div className="spinner" />
          </div>
          <div className="empty-state__title">Searching…</div>
          <div className="empty-state__text">Finding the best matches for you</div>
        </div>
      </div>
    );
  }

  // Empty results
  if (!isLoading && suggestions.length === 0) {
    return (
      <div className="dropdown">
        <div className="empty-state">
          <div className="empty-state__icon">
            <InboxIcon />
          </div>
          <div className="empty-state__title">No results found</div>
          <div className="empty-state__text">
            Try a different search term
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dropdown" role="listbox">
      <div className="dropdown__header">
        <span className="dropdown__label">Suggestions</span>
        <span className="dropdown__count">
          {suggestions.length} result{suggestions.length !== 1 ? 's' : ''}
        </span>
      </div>

      <ul className="dropdown__list">
        {suggestions.map((s, i) => (
          <SuggestionItem
            key={s.query}
            suggestion={s}
            prefix={prefix}
            isActive={i === activeIndex}
            onClick={() => onSelect(s.query)}
            onMouseEnter={() => onHover(i)}
          />
        ))}
      </ul>

      <div className="keyboard-hints">
        <span className="keyboard-hint">
          <kbd>↑</kbd><kbd>↓</kbd> Navigate
        </span>
        <span className="keyboard-hint">
          <kbd>Enter</kbd> Search
        </span>
        <span className="keyboard-hint">
          <kbd>Esc</kbd> Close
        </span>
      </div>
    </div>
  );
};

export default React.memo(Dropdown);
