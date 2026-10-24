import React from 'react';
import { RELIC_SPECS } from '../domain/constants';

interface RelicTileVisualProps {
  star: number;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  isGhost?: boolean;
  ghostStep?: 1 | 2;
  showName?: boolean;
  className?: string;
}

type StarToken = 's' | 'B' | 'P'; // 's' = small (1★), 'B' = big gold (5★), 'P' = big prismatic (5★ for 9★/10★)

const STAR_TOKENS_BY_LEVEL: Record<number, StarToken[]> = {
  1: ['s'],
  2: ['s', 's'],
  3: ['s', 's', 's'],
  4: ['s', 's', 's', 's'],
  5: ['B'],
  6: ['B', 's'],
  7: ['s', 'B', 's'],
  8: ['s', 'B', 's', 's'],
  9: ['s', 's', 'P', 's', 's'],
  10: ['P', 'P'],
};

const StarTokenSvg: React.FC<{
  token: StarToken;
  compact?: boolean;
}> = ({ token, compact = false }) => {
  const isBig = token === 'B' || token === 'P';
  const isPrismatic = token === 'P';

  const dimClass = compact
    ? isBig
      ? 'w-3.5 h-3.5 -mx-[1px]'
      : 'w-2.5 h-2.5 -mx-[1px]'
    : isBig
    ? 'w-4 h-4 sm:w-[19px] sm:h-[19px] -mx-[1.5px] z-10'
    : 'w-3 h-3 sm:w-[13px] sm:h-[13px] -mx-[1px]';

  return (
    <svg
      viewBox="0 0 24 24"
      className={`${dimClass} drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.95)] shrink-0`}
    >
      <polygon
        points="12,1.6 15.3,8.1 22.5,9.2 17.3,14.3 18.5,21.5 12,18.1 5.5,21.5 6.7,14.3 1.5,9.2 8.7,8.1"
        fill={
          isPrismatic
            ? '#E0F7FA'
            : isBig
            ? '#FFD54F'
            : '#FFCA28'
        }
        stroke="#2B190C"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      {/* Inner Top Highlight */}
      <polygon
        points="12,4.2 14.3,8.8 19.3,9.6 15.7,13.1 16.5,18.1 12,15.7 7.5,18.1 8.3,13.1 4.7,9.6 9.7,8.8"
        fill={
          isPrismatic
            ? '#FFF9C4'
            : isBig
            ? '#FFF176'
            : '#FFE082'
        }
        opacity="0.85"
      />
      {isPrismatic && (
        <circle cx="12" cy="11.5" r="3.2" fill="#80DEEA" opacity="0.65" />
      )}
    </svg>
  );
};

export const RelicStarBadgeRow: React.FC<{
  star: number;
  compact?: boolean;
}> = ({ star, compact = false }) => {
  const tokens = STAR_TOKENS_BY_LEVEL[star] ?? ['s'];
  return (
    <div className="inline-flex items-end justify-center leading-none">
      {tokens.map((t, idx) => (
        <StarTokenSvg key={idx} token={t} compact={compact} />
      ))}
    </div>
  );
};

export const RelicSvgIcon: React.FC<{ star: number; className?: string }> = ({
  star,
  className = 'w-6 h-6',
}) => {
  switch (star) {
    case 1: // 1★: Iron/Silver Diagonal Broadsword (pointing top-left)
      return (
        <svg viewBox="0 0 36 36" fill="none" className={className}>
          {/* Blade pointing top-left */}
          <polygon
            points="6,6 13,7 25,19 19,25 7,13"
            fill="#CFD8DC"
            stroke="#1C1917"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <polygon points="7,7 12,8 23,19 20,21" fill="#ECEFF1" />
          <line
            x1="10"
            y1="10"
            x2="20"
            y2="20"
            stroke="#78909C"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          {/* Gold Crossguard */}
          <path
            d="M16,27 L27,16 L29,18 L18,29 Z"
            fill="#FBC02D"
            stroke="#1C1917"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          {/* Grip & Pommel */}
          <path
            d="M23,25 L29,31 L31,29 L25,23 Z"
            fill="#6D4C41"
            stroke="#1C1917"
            strokeWidth="1.8"
          />
          <circle
            cx="30.5"
            cy="30.5"
            r="2.4"
            fill="#FBC02D"
            stroke="#1C1917"
            strokeWidth="1.6"
          />
        </svg>
      );

    case 2: // 2★: Green Twin-Wing Cloak (two symmetrical lime/green mantle wings with jagged tips)
      return (
        <svg viewBox="0 0 36 36" fill="none" className={className}>
          {/* Left Cloak Wing */}
          <path
            d="M16,6 L11,7 L5,24 L9,29 L11,24 L14,29 L16.5,14 Z"
            fill="#66BB6A"
            stroke="#1B1B1B"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M15.5,7 L11.5,8 L7.5,20 L14,15 Z" fill="#C6FF00" />
          <polygon points="5,24 9,29 10.5,24.5" fill="#FDD835" />

          {/* Right Cloak Wing */}
          <path
            d="M20,6 L25,7 L31,24 L27,29 L25,24 L22,29 L19.5,14 Z"
            fill="#66BB6A"
            stroke="#1B1B1B"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M20.5,7 L24.5,8 L28.5,20 L22,15 Z" fill="#C6FF00" />
          <polygon points="31,24 27,29 25.5,24.5" fill="#FDD835" />
        </svg>
      );

    case 3: // 3★: Blue & Gold Royal Plate Cuirass
      return (
        <svg viewBox="0 0 36 36" fill="none" className={className}>
          {/* Shoulder Pauldrons & Chestplate */}
          <path
            d="M11,7 L18,10 L25,7 L30,12 L26,17 L25,28 L18,31 L11,28 L10,17 L6,12 Z"
            fill="#2979FF"
            stroke="#1B1B1B"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* Gold Collar & Shoulder Trim */}
          <path
            d="M11,7 L18,11 L25,7 M7,12 L11,15 M29,12 L25,15 M11,24 L18,27 L25,24"
            stroke="#FFD54F"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Gold Center Crest */}
          <polygon
            points="18,13 21,18 18,23 15,18"
            fill="#FFD54F"
            stroke="#1B1B1B"
            strokeWidth="1.4"
          />
        </svg>
      );

    case 4: // 4★: Purple Ruby Warhammer (ornate silver/gold hammer head with 3 red rubies & crimson handle)
      return (
        <svg viewBox="0 0 36 36" fill="none" className={className}>
          {/* Diagonal Crimson Handle */}
          <path
            d="M16,16 L29,29 L26.5,31.5 L13.5,18.5 Z"
            fill="#D32F2F"
            stroke="#1B1B1B"
            strokeWidth="2"
          />
          <circle
            cx="29"
            cy="29"
            r="2.2"
            fill="#FFD54F"
            stroke="#1B1B1B"
            strokeWidth="1.5"
          />
          {/* Spiked Top Tip */}
          <polygon
            points="7,7 12,9 9,12"
            fill="#FFD54F"
            stroke="#1B1B1B"
            strokeWidth="1.8"
          />
          {/* Ornate Hammer Head */}
          <path
            d="M14,6 L24,16 L16,24 L6,14 Z"
            fill="#CFD8DC"
            stroke="#1B1B1B"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* Gold Trim Bands */}
          <path
            d="M12,8 L22,18 M8,12 L18,22"
            stroke="#FFD54F"
            strokeWidth="2.2"
          />
          {/* 3 Red Rubies */}
          <rect
            x="13"
            y="10"
            width="4"
            height="4"
            transform="rotate(45 15 12)"
            fill="#FF1744"
            stroke="#1B1B1B"
            strokeWidth="1.2"
          />
          <rect
            x="10"
            y="13"
            width="4"
            height="4"
            transform="rotate(45 12 15)"
            fill="#FF1744"
            stroke="#1B1B1B"
            strokeWidth="1.2"
          />
          <rect
            x="16"
            y="13"
            width="4"
            height="4"
            transform="rotate(45 18 15)"
            fill="#FF1744"
            stroke="#1B1B1B"
            strokeWidth="1.2"
          />
        </svg>
      );

    case 5: // 5★: Crimson Flame Greatsword (diagonal fiery blade pointing top-left)
      return (
        <svg viewBox="0 0 36 36" fill="none" className={className}>
          {/* Outer Red/Orange Flame Blade */}
          <path
            d="M5,5 C12,5 17,9 24,18 L18,24 C10,17 5,12 5,5 Z"
            fill="#FF1744"
            stroke="#1B1B1B"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* Inner White-Hot / Yellow Flame Edge */}
          <path
            d="M6.5,6.5 C11,7 15,11 20,17 L16,20 C11,15 7,11 6.5,6.5 Z"
            fill="#FFF59D"
          />
          {/* Dragon-Wing Crimson & Gold Guard */}
          <path
            d="M15,26 C18,21 21,18 27,14 C26,19 24,22 28,23 C23,24 20,26 19,29 Z"
            fill="#FFD54F"
            stroke="#1B1B1B"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          {/* Hilt */}
          <path
            d="M22,22 L30,30"
            stroke="#B71C1C"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <circle
            cx="30"
            cy="30"
            r="2.2"
            fill="#FFD54F"
            stroke="#1B1B1B"
            strokeWidth="1.5"
          />
        </svg>
      );

    case 6: // 6★: Gold Dragon Amulet (Hanging necklace cord with winged golden dragon & cyan gem)
      return (
        <svg viewBox="0 0 36 36" fill="none" className={className}>
          {/* Necklace Cord at Top */}
          <path
            d="M6,5 Q18,13 30,5"
            stroke="#3E2723"
            strokeWidth="2"
            fill="none"
          />
          <circle cx="18" cy="9" r="2" fill="#FFD54F" stroke="#1B1B1B" strokeWidth="1.4" />
          {/* Left & Right Golden Dragon Wings */}
          <path
            d="M17,12 C11,9 6,12 6,19 C9,17 12,18 15,21 Z"
            fill="#FFC107"
            stroke="#1B1B1B"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M19,12 C25,9 30,12 30,19 C27,17 24,18 21,21 Z"
            fill="#FFC107"
            stroke="#1B1B1B"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          {/* Curled Dragon Body & Tail */}
          <path
            d="M18,10 C15,15 15,22 20,26 C22,28 19,31 15,29"
            stroke="#FFB300"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M18,10 C15,15 15,22 20,26 C22,28 19,31 15,29"
            stroke="#1B1B1B"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          {/* Glowing Cyan Dragon Heart Gem */}
          <circle
            cx="15.5"
            cy="16.5"
            r="2.4"
            fill="#00E5FF"
            stroke="#1B1B1B"
            strokeWidth="1.3"
          />
        </svg>
      );

    case 7: // 7★: Cyan Horned Dragon Scale Armor
      return (
        <svg viewBox="0 0 36 36" fill="none" className={className}>
          {/* Golden Dragon Horns */}
          <path
            d="M13,10 L9,4 L15,8 M23,10 L27,4 L21,8"
            fill="#FFD54F"
            stroke="#1B1B1B"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          {/* Layered Cyan Scale Pauldrons */}
          <path
            d="M5,13 L13,10 L11,22 L4,19 Z M31,13 L23,10 L25,22 L32,19 Z"
            fill="#00E5FF"
            stroke="#1B1B1B"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          {/* Central Dragon Scale Chest & Ice Spikes */}
          <polygon
            points="18,8 25,13 23,28 18,31 13,28 11,13"
            fill="#1E88E5"
            stroke="#1B1B1B"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <polygon
            points="18,12 22,16 18,22 14,16"
            fill="#80D8FF"
            stroke="#1B1B1B"
            strokeWidth="1.5"
          />
          <polygon
            points="12,24 15,30 18,25 21,30 24,24"
            fill="#E0F7FA"
            stroke="#1B1B1B"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 8: // 8★: Molten Ruby Magma Core in Volcanic Stone & Gold Band
      return (
        <svg viewBox="0 0 36 36" fill="none" className={className}>
          {/* Dark Volcanic Rock Base */}
          <path
            d="M6,20 L10,11 L26,11 L30,20 L25,29 L11,29 Z"
            fill="#455A64"
            stroke="#1B1B1B"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* Glowing Molten Magma Core */}
          <circle
            cx="18"
            cy="16.5"
            r="8.5"
            fill="#FF1744"
            stroke="#1B1B1B"
            strokeWidth="2"
          />
          {/* Magma Cracks & Specular Highlight */}
          <path
            d="M13,13 L18,16 L22,12 M18,16 L17,22"
            stroke="#FFEA00"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <ellipse cx="15" cy="12.5" rx="3" ry="1.6" fill="#FF8A80" />
          {/* Golden Crown Claws */}
          <path
            d="M7,21 Q18,27 29,21 L27,26 Q18,31 9,26 Z"
            fill="#FFD54F"
            stroke="#1B1B1B"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 9: // 9★: Celestial Winged Golden Battleaxe
      return (
        <svg viewBox="0 0 36 36" fill="none" className={className}>
          {/* White Feathered Angel Wings */}
          <path
            d="M17,14 C11,7 5,8 4,15 C8,16 11,18 14,20 Z M19,14 C25,7 31,8 32,15 C28,16 25,18 22,20 Z"
            fill="#FFFDE7"
            stroke="#1B1B1B"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          {/* Diagonal Axe Handle */}
          <path
            d="M12,12 L29,29"
            stroke="#FFB300"
            strokeWidth="3.8"
            strokeLinecap="round"
          />
          <path
            d="M12,12 L29,29"
            stroke="#1B1B1B"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          {/* Golden Crescent Battleaxe Blade */}
          <path
            d="M15,8 C7,10 5,19 11,25 C14,21 16,18 19,15 Z"
            fill="#FFD54F"
            stroke="#1B1B1B"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* Emerald Core Gem */}
          <circle
            cx="17"
            cy="16"
            r="2.8"
            fill="#00E676"
            stroke="#1B1B1B"
            strokeWidth="1.5"
          />
        </svg>
      );

    case 10: // 10★: Mythic Primordial Crown Relic
    default:
      return (
        <svg viewBox="0 0 36 36" fill="none" className={className}>
          <path
            d="M5,25 L8,10 L14,17 L18,6 L22,17 L28,10 L31,25 Z"
            fill="#FFD54F"
            stroke="#1B1B1B"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle
            cx="18"
            cy="19"
            r="4"
            fill="#FF1744"
            stroke="#FFF59D"
            strokeWidth="1.6"
          />
          <circle cx="11" cy="20" r="2" fill="#00E5FF" />
          <circle cx="25" cy="20" r="2" fill="#00E5FF" />
        </svg>
      );
  }
};

export const RelicTileVisual: React.FC<RelicTileVisualProps> = ({
  star,
  size = 'md',
  isGhost = false,
  ghostStep = 1,
  showName = false,
  className = '',
}) => {
  const spec = RELIC_SPECS[star];
  if (!spec) return null;

  const sizeClasses = {
    xs: 'w-7 h-7 rounded-md text-[10px]',
    sm: 'w-10 h-10 rounded-xl text-xs',
    md: 'w-full h-full rounded-xl text-xs',
    lg: 'w-16 h-16 rounded-2xl text-base',
  }[size];

  const iconSizes = {
    xs: 'w-4 h-4',
    sm: 'w-6 h-6',
    md: 'w-8 h-8 sm:w-9 sm:h-9',
    lg: 'w-11 h-11',
  }[size];

  // Special holographic / glowing frames for 7★, 8★, 9★, 10★ matching screenshot
  const isCyanGlow7 = star === 7;
  const isPrismatic8 = star === 8;
  const isRainbow9Or10 = star >= 9;

  const frameShadow = isGhost
    ? undefined
    : isRainbow9Or10
    ? '0 0 12px rgba(128,222,234,0.75), inset 0 0 8px rgba(255,214,236,0.6)'
    : isPrismatic8
    ? '0 0 10px rgba(224,242,254,0.65), inset 0 0 6px rgba(255,255,255,0.45)'
    : isCyanGlow7
    ? '0 0 10px rgba(34,211,238,0.6), inset 0 0 5px rgba(125,211,252,0.4)'
    : 'inset 0 2px 5px rgba(255,255,255,0.22), 0 3px 6px rgba(0,0,0,0.5)';

  return (
    <div
      className={`relative flex flex-col items-center justify-between select-none overflow-hidden transition-transform duration-150 ${sizeClasses} ${
        isGhost
          ? ghostStep === 1
            ? 'opacity-90 ring-2 ring-amber-300 shadow-[0_0_16px_rgba(251,191,36,0.55)]'
            : 'opacity-75 ring-2 ring-cyan-300 border-dashed shadow-[0_0_12px_rgba(34,211,238,0.4)]'
          : ''
      } ${className}`}
      style={{
        backgroundColor: isGhost ? `${spec.bgHex}CC` : spec.bgHex,
        border: `${isPrismatic8 || isRainbow9Or10 ? '2.5px' : '2px'} ${
          isGhost && ghostStep === 2 ? 'dashed' : 'solid'
        } ${spec.borderHex}`,
        boxShadow: frameShadow,
      }}
    >
      {/* Subtle In-Game Radial Sunburst Rays Background */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage:
            'repeating-conic-gradient(from 0deg, rgba(255,255,255,0.28) 0deg 12deg, transparent 12deg 24deg)',
        }}
      />

      {/* Holographic Corner Dots for 8★, 9★, 10★ */}
      {(isPrismatic8 || isRainbow9Or10) && size !== 'xs' && (
        <>
          <span className="absolute top-1 left-1 w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_4px_#fff] pointer-events-none" />
          <span className="absolute bottom-1.5 right-1 w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_4px_#fff] pointer-events-none" />
        </>
      )}

      {/* Top-Left Compact Numeric Level Pill */}
      <div className="relative z-10 w-full flex items-center justify-between px-1 pt-0.5 leading-none">
        <span
          className={`font-black tracking-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] ${
            size === 'xs' ? 'text-[9px]' : 'text-[10px] sm:text-[11px]'
          } text-white/95`}
        >
          {star}
        </span>
      </div>

      {/* Center Detailed Relic Illustration */}
      <div className="relative z-10 flex items-center justify-center -mt-1 my-auto drop-shadow-[0_2px_3px_rgba(0,0,0,0.65)]">
        <RelicSvgIcon star={star} className={iconSizes} />
      </div>

      {/* Bottom In-Game Star Badge Cluster (Big Star = 5, Small Star = 1) */}
      {size !== 'xs' && (
        <div className="relative z-10 w-full flex flex-col items-center pb-0.5 leading-none">
          <RelicStarBadgeRow star={star} compact={size === 'sm'} />
          {showName && (
            <span className="text-[9px] text-white/90 truncate max-w-full px-1 mt-0.5">
              {spec.shortName}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
