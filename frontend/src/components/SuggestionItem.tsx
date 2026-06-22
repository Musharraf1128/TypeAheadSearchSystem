import React from 'react';
import type { Suggestion } from '../types';
import { formatCount, isTrending } from '../utils';
import { SearchIcon, TrendingIcon, ArrowUpRightIcon } from './Icons';

interface SuggestionItemProps {
  suggestion: Suggestion;
  prefix: string;
  isActive: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}

/**
 * Highlights the prefix portion of the query text.
 */
function highlightMatch(text: string, prefix: string): React.ReactNode {
  const lowerText = text.toLowerCase();
  const lowerPrefix = prefix.toLowerCase();
  const idx = lowerText.indexOf(lowerPrefix);

  if (idx === -1 || !prefix) {
    return text;
  }

  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + prefix.length);
  const after = text.slice(idx + prefix.length);

  return (
    <>
      {before}
      <span className="highlight">{match}</span>
      {after}
    </>
  );
}

const SuggestionItem: React.FC<SuggestionItemProps> = ({
  suggestion,
  prefix,
  isActive,
  onClick,
  onMouseEnter,
}) => {
  const trending = isTrending(suggestion.trendingScore);

  return (
    <li
      className={`suggestion ${isActive ? 'suggestion--active' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      role="option"
      aria-selected={isActive}
    >
      <div className="suggestion__icon">
        {trending ? <TrendingIcon /> : <SearchIcon />}
      </div>

      <div className="suggestion__content">
        <div className="suggestion__query">
          {highlightMatch(suggestion.query, prefix)}
        </div>
        <div className="suggestion__meta">
          <span className="suggestion__count">
            {formatCount(suggestion.count)} searches
          </span>
          {trending && (
            <span className="trending-badge">
              <TrendingIcon />
              Trending
            </span>
          )}
        </div>
      </div>

      <div className="suggestion__arrow">
        <ArrowUpRightIcon />
      </div>
    </li>
  );
};

export default React.memo(SuggestionItem);
