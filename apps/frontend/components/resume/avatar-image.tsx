import React from 'react';
import type { AvatarSettings } from '@/lib/types/template-settings';
import baseStyles from './styles/_base.module.css';

interface AvatarImageProps {
  src: string;
  alt?: string;
  settings: AvatarSettings;
}

export const AvatarImage: React.FC<AvatarImageProps> = ({ src, alt = '', settings }) => {
  if (!settings.show || !src) return null;

  return (
    <img
      src={src}
      alt={alt}
      className={baseStyles['resume-avatar']}
      style={{
        width: 'var(--avatar-size)',
        height: 'var(--avatar-size)',
        borderRadius: 'var(--avatar-shape)',
        borderWidth: 'var(--avatar-border)',
      }}
    />
  );
};
