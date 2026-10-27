import {
  BookOpen,
  BriefcaseBusiness,
  Heart,
  Home,
  Sparkles,
  Sprout,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import type { DomainIconKey } from "../domain/life/LifeDomain";

const domainIcons: Record<DomainIconKey, LucideIcon> = {
  heart: Heart,
  briefcase: BriefcaseBusiness,
  users: UsersRound,
  wallet: WalletCards,
  sprout: Sprout,
  home: Home,
  "book-open": BookOpen,
  sparkles: Sparkles,
};

interface DomainIconProps {
  icon: DomainIconKey;
  size?: number;
  strokeWidth?: number;
}

export function DomainIcon({ icon, size = 20, strokeWidth = 1.8 }: DomainIconProps) {
  const Icon = domainIcons[icon];
  return <Icon aria-hidden="true" size={size} strokeWidth={strokeWidth} />;
}
