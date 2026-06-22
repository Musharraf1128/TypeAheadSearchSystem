import React from 'react';
import { CheckCircleIcon } from './Icons';

interface SearchToastProps {
  title: string;
  message: string;
  exiting: boolean;
}

const SearchToast: React.FC<SearchToastProps> = ({ title, message, exiting }) => (
  <div className={`search-toast ${exiting ? 'search-toast--exiting' : ''}`}>
    <div className="search-toast__icon">
      <CheckCircleIcon />
    </div>
    <div className="search-toast__content">
      <div className="search-toast__title">{title}</div>
      <div className="search-toast__message">{message}</div>
    </div>
  </div>
);

export default React.memo(SearchToast);
