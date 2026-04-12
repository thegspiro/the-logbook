import React from 'react';
import { Star } from 'lucide-react';

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  max?: number;
  size?: 'sm' | 'md';
  label?: string;
}

const sizeClasses = {
  sm: 'w-3.5 h-3.5',
  md: 'w-5 h-5',
} as const;

const StarRating: React.FC<StarRatingProps> = ({
  value,
  onChange,
  max = 5,
  size = 'md',
  label,
}) => {
  const starClass = sizeClasses[size];
  const interactive = !!onChange;

  const filledClass =
    size === 'sm'
      ? 'fill-amber-400 text-amber-700 dark:text-amber-400'
      : 'fill-amber-400 text-amber-400';

  const emptyClass = interactive
    ? 'text-theme-text-muted hover:text-amber-300'
    : 'text-theme-text-muted';

  return (
    <div
      className={`flex items-center ${size === 'sm' ? 'gap-0.5' : 'gap-1'}`}
      role={interactive ? 'radiogroup' : 'img'}
      aria-label={label || `Rating: ${value} out of ${max}`}
    >
      {Array.from({ length: max }, (_, i) => i + 1).map(i => {
        const filled = i <= value;
        const starEl = (
          <Star className={`${starClass} ${filled ? filledClass : emptyClass}`} />
        );

        if (interactive) {
          return (
            <button
              key={i}
              type="button"
              onClick={() => onChange(i)}
              className="p-0.5"
              aria-label={`${i} star${i !== 1 ? 's' : ''}`}
            >
              {starEl}
            </button>
          );
        }

        return <span key={i}>{starEl}</span>;
      })}
    </div>
  );
};

export default StarRating;
