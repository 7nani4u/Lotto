import React from 'react';
import { calculateBallColor } from '../services/lottoService';

export const Ball: React.FC<{ num: number; isBonus?: boolean; onClick?: () => void; small?: boolean; responsive?: boolean }> = ({
  num,
  isBonus,
  onClick,
  small,
  responsive,
}) => {
  let sizeClass = small ? 'w-8 h-8 text-xs sm:text-sm' : 'w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 text-[15px] sm:text-lg md:text-xl flex-shrink-0';
  let borderClass = isBonus ? 'border-[3px] border-dashed border-gray-300 ' : '';

  if (responsive) {
    sizeClass = 'w-[26px] h-[26px] sm:w-8 sm:h-8 md:w-12 md:h-12 text-[11px] sm:text-sm md:text-xl flex-shrink-0';
    borderClass = isBonus ? 'border-2 sm:border-[3px] border-dashed border-gray-300 ' : '';
  }

  return (
    <div
      onClick={onClick}
      className={`${sizeClass} rounded-full flex items-center justify-center font-bold shadow-lg ${borderClass}${onClick ? 'cursor-pointer hover:scale-110 transition-transform ' : ''}${calculateBallColor(num)}`}
    >
      {num}
    </div>
  );
};
