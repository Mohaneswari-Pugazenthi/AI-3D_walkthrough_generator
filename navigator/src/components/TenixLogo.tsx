import React from 'react';

interface TenixLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
}

export const TenixLogo: React.FC<TenixLogoProps> = ({
  size = 'md',
  showText = true,
  className = '',
  ...props
}) => {
  const sizeMap = {
    sm: { height: 28, textWidth: 120 },
    md: { height: 36, textWidth: 155 },
    lg: { height: 52, textWidth: 220 },
    xl: { height: 80, textWidth: 340 },
  };

  const currentSize = sizeMap[size];

  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      <svg
        viewBox="0 0 285 160"
        height={currentSize.height}
        className="w-auto shrink-0"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        {/* Neon Green Infinity-T Symbol */}
        <g stroke="#12E700" strokeWidth="18" strokeLinecap="square" strokeLinejoin="miter">
          {/* Top T bar */}
          <path d="M 22 45 H 122 V 76 H 68" strokeWidth="18" />
          {/* Left loop & Stem */}
          <path
            d="M 68 45 V 105 C 68 128 92 142 120 142 C 148 142 168 122 188 95 C 208 68 228 45 258 45 C 285 45 305 65 305 92.5 C 305 120 285 140 258 140 C 228 140 208 117 188 90 C 168 63 148 45 120 45 C 92 45 68 62 68 85"
            strokeWidth="18"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
      
      {showText && (
        <span className="font-extrabold tracking-wider text-foreground font-sans uppercase leading-none"
              style={{ fontSize: `${currentSize.height * 0.72}px` }}>
          TENIX
        </span>
      )}
    </div>
  );
};

export default TenixLogo;
