"use client";

import { useState } from "react";

export default function FallbackImage({
  src,
  alt,
  className,
  style,
}: {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [error, setError] = useState(false);

  if (error || !src) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-elevated)",
          color: "var(--text-muted)",
          fontSize: "1.5rem",
          ...style,
        }}
      >
        🃏
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      onError={() => setError(true)}
      loading="lazy"
    />
  );
}
