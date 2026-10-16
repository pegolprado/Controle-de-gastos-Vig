import {
  Briefcase, Car, CircleDashed, GraduationCap, HeartPulse, Home, Landmark, PartyPopper, PlusCircle, Repeat,
  ShoppingBag, Sparkles, Tag, TrendingUp, Utensils, Plane, Gift, Dog, Baby, Shirt, Smartphone, Wifi, Fuel,
  Dumbbell, Coffee, Bus, Pill, BookOpen, Wrench, Zap, Droplets, Film, Music, Gamepad2, PiggyBank, Target,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  tag: Tag, utensils: Utensils, home: Home, car: Car, 'heart-pulse': HeartPulse, 'graduation-cap': GraduationCap,
  'party-popper': PartyPopper, repeat: Repeat, 'shopping-bag': ShoppingBag, landmark: Landmark, 'circle-dashed': CircleDashed,
  briefcase: Briefcase, sparkles: Sparkles, 'trending-up': TrendingUp, 'plus-circle': PlusCircle, plane: Plane, gift: Gift,
  dog: Dog, baby: Baby, shirt: Shirt, smartphone: Smartphone, wifi: Wifi, fuel: Fuel, dumbbell: Dumbbell, coffee: Coffee,
  bus: Bus, pill: Pill, 'book-open': BookOpen, wrench: Wrench, zap: Zap, droplets: Droplets, film: Film, music: Music,
  gamepad: Gamepad2, 'piggy-bank': PiggyBank, target: Target,
};

export function CategoryIcon({ icon, color, size = 'md', className }: { icon?: string | null; color?: string | null; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const Icon = CATEGORY_ICONS[icon ?? 'tag'] ?? Tag;
  const dims = { sm: 'size-7 rounded-lg', md: 'size-9 rounded-xl', lg: 'size-11 rounded-2xl' };
  const iconSize = { sm: 'size-3.5', md: 'size-4', lg: 'size-5' };
  const c = color ?? '#64748b';
  return (
    <span
      className={cn('grid shrink-0 place-items-center', dims[size], className)}
      style={{ backgroundColor: `${c}1f`, color: c, boxShadow: `inset 0 0 0 1px ${c}33` }}
      aria-hidden
    >
      <Icon className={iconSize[size]} />
    </span>
  );
}

export const SWATCHES = ['#10b981', '#22c55e', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#64748b', '#78716c'];

export function ColorPicker({ value, onChange, label = 'Cor' }: { value: string; onChange: (c: string) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn('size-8 rounded-full border-2 transition', value === c ? 'scale-110 border-fg' : 'border-transparent')}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}
