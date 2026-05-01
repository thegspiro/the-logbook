/**
 * Avatar — circular member avatar with photo, or initials on a deterministic
 * slate-ramp background so a directory of fallbacks is visually scannable
 * (every member previously rendered with the same blue circle, defeating
 * the purpose of an avatar at a glance).
 */

import React from 'react';

const SIZE_CLASSES = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-20 h-20 text-xl',
} as const;

type Size = keyof typeof SIZE_CLASSES;

interface AvatarProps {
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  photoUrl?: string | null | undefined;
  size?: Size | undefined;
  className?: string | undefined;
  alt?: string | undefined;
}

// Six deterministic backgrounds drawn from the slate ramp + supporting hues.
// Tailwind class strings (must be full literals so the JIT picks them up).
const BG_PALETTE: string[] = [
  'bg-slate-500 text-white',
  'bg-slate-700 text-white',
  'bg-zinc-600 text-white',
  'bg-stone-600 text-white',
  'bg-blue-700 text-white',
  'bg-emerald-700 text-white',
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getInitials(firstName?: string | null, lastName?: string | null): string {
  const first = firstName?.trim().charAt(0) || '';
  const last = lastName?.trim().charAt(0) || '';
  return (first + last).toUpperCase() || '?';
}

export const Avatar: React.FC<AvatarProps> = ({
  firstName,
  lastName,
  photoUrl,
  size = 'md',
  className = '',
  alt,
}) => {
  const sizeClass = SIZE_CLASSES[size];
  const fullName = `${firstName || ''} ${lastName || ''}`.trim();
  const altText = alt ?? (fullName || 'Member avatar');

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={altText}
        className={`${sizeClass} rounded-full object-cover shrink-0 ${className}`}
      />
    );
  }

  // Deterministic so the same member always gets the same colour across pages.
  const seed = fullName || altText;
  const bgClass = BG_PALETTE[hashString(seed) % BG_PALETTE.length] ?? 'bg-slate-500 text-white';

  return (
    <div
      role="img"
      aria-label={altText}
      className={`${sizeClass} ${bgClass} rounded-full flex items-center justify-center font-semibold shrink-0 ${className}`}
    >
      {getInitials(firstName, lastName)}
    </div>
  );
};
