import React from 'react';
import { Star } from 'lucide-react';

interface StarRatingProps {
  value: number;
  onChange: (val: number) => void;
  size?: 'sm' | 'md';
}

export const StarRating: React.FC<StarRatingProps> = ({ value, onChange, size = 'md' }) => {
  const sizeClass = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6';
  return (
    <div className="flex items-center space-x-1" role="radiogroup" aria-label="Performance rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          aria-label={`${star} star${star !== 1 ? 's' : ''}`}
          aria-pressed={star <= value}
          className="focus:outline-2 focus:outline-offset-1 focus:outline-violet-500 rounded"
        >
          <Star
            className={`${sizeClass} ${star <= value ? 'text-yellow-700 dark:text-yellow-400 fill-yellow-400' : 'text-theme-text-muted'}`}
          />
        </button>
      ))}
    </div>
  );
};
