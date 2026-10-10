import type * as React from 'react';

export type IconName = 'search' | 'heart' | 'user' | 'users' | 'map' | 'cal' | 'chat' | 'bell' | 'right' | 'back' | 'pin' | 'plus' | 'list' | 'home' | 'clock' | 'car' | 'walk' | 'camera' | 'book' | 'gear' | 'check' | 'x';

export interface IconProps { name: IconName; size?: number; stroke?: number; className?: string }
export declare function Icon(props: IconProps): React.ReactElement;

export interface ButtonProps { variant?: 'primary' | 'secondary' | 'text'; size?: 'md' | 'sm'; block?: boolean; icon?: IconName; disabled?: boolean; type?: 'button' | 'submit'; onClick?: () => void; className?: string; children?: React.ReactNode }
export declare function Button(props: ButtonProps): React.ReactElement;

export interface IconButtonProps { icon: IconName; label: string; variant?: 'plain' | 'soft' | 'float' | 'photo'; pressed?: boolean; size?: number; onClick?: () => void; className?: string }
export declare function IconButton(props: IconButtonProps): React.ReactElement;

export interface SearchBarProps { label?: string; hint?: string; onClick?: () => void }
export declare function SearchBar(props: SearchBarProps): React.ReactElement;

export interface CategoryTabsProps { items: { key: string; label: string; icon: IconName }[]; value: string; onChange?: (key: string) => void }
export declare function CategoryTabs(props: CategoryTabsProps): React.ReactElement;

export interface ChipProps { selected?: boolean; icon?: IconName; count?: number; onClick?: () => void; children?: React.ReactNode }
export declare function Chip(props: ChipProps): React.ReactElement;

export interface BadgeProps { tone?: 'neutral' | 'brand' | 'warn' | 'photo'; children?: React.ReactNode }
export declare function Badge(props: BadgeProps): React.ReactElement;

export interface TextFieldProps { label: string; id?: string; value?: string; defaultValue?: string; placeholder?: string; error?: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void }
export declare function TextField(props: TextFieldProps): React.ReactElement;

export interface TripCardProps { title: string; lines?: string[]; image?: string; imageAlt?: string; place?: string; badge?: string; saved?: boolean; onToggleSave?: () => void; size?: 'md' | 'lg'; footer?: React.ReactNode }
export declare function TripCard(props: TripCardProps): React.ReactElement;

export interface ListRowProps { label: string; sub?: string; icon?: IconName; trailing?: React.ReactNode; onClick?: () => void }
export declare function ListRow(props: ListRowProps): React.ReactElement;

export interface TabBarProps { items: { key: string; label: string; icon: IconName }[]; value: string; onChange?: (key: string) => void }
export declare function TabBar(props: TabBarProps): React.ReactElement;

declare global {
  interface Window {
    YoungTrip: { Icon: typeof Icon; Button: typeof Button; IconButton: typeof IconButton; SearchBar: typeof SearchBar; CategoryTabs: typeof CategoryTabs; Chip: typeof Chip; Badge: typeof Badge; TextField: typeof TextField; TripCard: typeof TripCard; ListRow: typeof ListRow; TabBar: typeof TabBar };
  }
}
