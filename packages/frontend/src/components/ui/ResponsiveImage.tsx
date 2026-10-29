import React, { useState } from 'react';

export interface ResponsiveImageProps {
  src: string;
  alt: string;
  width?: number | string;
  height?: number | string;
  aspectRatio?: string;
  className?: string;
  pictureClassName?: string;
  priority?: boolean;
  fallbackSrc?: string;
}

/**
 * Responsive Image component supporting AVIF and WebP modern image formats
 * with layout dimension preservation to achieve Cumulative Layout Shift (CLS) < 0.1.
 */
export const ResponsiveImage: React.FC<ResponsiveImageProps> = ({
  src,
  alt,
  width,
  height,
  aspectRatio = '16/9',
  className = '',
  pictureClassName = '',
  priority = false,
  fallbackSrc = '/og-default.png',
}) => {
  const [hasError, setHasError] = useState(false);

  // If the image is a vector SVG, data URL, or external placeholder, render directly
  const isSvg = src.endsWith('.svg') || src.startsWith('data:image/svg');
  const effectiveSrc = hasError ? fallbackSrc : src;

  // Generate AVIF and WebP URLs if local or standard image path
  const isRelativeOrUpload =
    src.startsWith('/') || src.startsWith('http://') || src.startsWith('https://');
  const canDeriveFormats =
    isRelativeOrUpload &&
    !isSvg &&
    !src.startsWith('data:') &&
    /\.(jpe?g|png)$/i.test(src);

  const avifSrc = canDeriveFormats ? src.replace(/\.(jpe?g|png)$/i, '.avif') : null;
  const webpSrc = canDeriveFormats ? src.replace(/\.(jpe?g|png)$/i, '.webp') : null;

  return (
    <picture className={`block relative overflow-hidden ${pictureClassName}`}>
      {avifSrc && <source srcSet={avifSrc} type="image/avif" />}
      {webpSrc && <source srcSet={webpSrc} type="image/webp" />}
      <img
        src={effectiveSrc}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setHasError(true)}
        style={{ aspectRatio }}
        className={`w-full h-full object-cover transition-opacity duration-300 ${className}`}
      />
    </picture>
  );
};
