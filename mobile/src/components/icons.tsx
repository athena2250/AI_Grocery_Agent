import React from 'react';
import Svg, { Path, Rect, Circle } from 'react-native-svg';

/** Line icons from Hearth.html (24×24 grid, round caps). */
type P = { size?: number; color: string; strokeWidth?: number };

const base = (size: number, color: string, sw: number) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: color, strokeWidth: sw, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
});

export const HomeIcon = ({ size = 22, color, strokeWidth = 1.7 }: P) => (
  <Svg {...base(size, color, strokeWidth)}><Path d="M3 10.5 12 3l9 7.5" /><Path d="M5 9.5V21h14V9.5" /></Svg>
);
export const CheckIcon = ({ size = 22, color, strokeWidth = 1.7 }: P) => (
  <Svg {...base(size, color, strokeWidth)}><Path d="M4 12.5 9 17l11-11" /></Svg>
);
export const CartIcon = ({ size = 22, color, strokeWidth = 1.7 }: P) => (
  <Svg {...base(size, color, strokeWidth)}>
    <Path d="M3 4h2l2.5 12h11L21 7H6.5" /><Circle cx={9} cy={20} r={1.3} /><Circle cx={18} cy={20} r={1.3} />
  </Svg>
);
export const MenuIcon = ({ size = 22, color, strokeWidth = 1.7 }: P) => (
  <Svg {...base(size, color, strokeWidth)}><Path d="M4 7h16M4 12h16M4 17h16" /></Svg>
);
export const PlusIcon = ({ size = 24, color, strokeWidth = 1.8 }: P) => (
  <Svg {...base(size, color, strokeWidth)}><Path d="M12 5v14M5 12h14" /></Svg>
);
export const MicIcon = ({ size = 22, color, strokeWidth = 1.7 }: P) => (
  <Svg {...base(size, color, strokeWidth)}><Rect x={9} y={3} width={6} height={12} rx={3} /><Path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Svg>
);
export const TrashIcon = ({ size = 18, color, strokeWidth = 1.6 }: P) => (
  <Svg {...base(size, color, strokeWidth)}><Path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></Svg>
);
