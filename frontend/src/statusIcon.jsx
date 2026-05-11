import React from 'react';
import { Check, X, Star, Clock, Trash2 } from 'lucide-react';

export const STATUS_COLOR = {
  keep: 'var(--accent-keep)',
  best: 'var(--accent-keep)',
  reject: 'var(--accent-reject)',
  skip: 'var(--accent-skip)',
  trash: 'var(--accent-reject)',
};

export function StatusIcon({ status, size = 16, fillBest = true }) {
  if (!status) return null;
  const color = STATUS_COLOR[status] || 'currentColor';
  switch (status) {
    case 'keep':
      return <Check size={size} color={color} />;
    case 'best':
      return <Star size={size} color={color} fill={fillBest ? color : 'none'} />;
    case 'reject':
      return <X size={size} color={color} />;
    case 'skip':
      return <Clock size={size} color={color} />;
    case 'trash':
      return <Trash2 size={size} color={color} />;
    default:
      return null;
  }
}
