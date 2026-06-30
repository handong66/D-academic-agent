import {
  IconAlertTriangle,
  IconBooks,
  IconChartDots,
  IconCheckupList,
  IconCircleCheck,
  IconCircleX,
  IconCpu,
  IconGavel,
  IconInfoCircle,
  IconListDetails,
  IconLoader2,
  IconMicroscope,
  IconMoon,
  IconPencil,
  IconPlayerPlay,
  IconReportAnalytics,
  IconScale,
  IconSearch,
  IconSettings,
  IconSitemap,
  IconSun,
  IconTable,
  type TablerIcon,
} from "@tabler/icons-react";

const ICONS: Record<string, TablerIcon> = {
  "alert-triangle": IconAlertTriangle,
  books: IconBooks,
  "chart-dots": IconChartDots,
  "checkup-list": IconCheckupList,
  "circle-check": IconCircleCheck,
  "circle-x": IconCircleX,
  cpu: IconCpu,
  gavel: IconGavel,
  "info-circle": IconInfoCircle,
  "list-details": IconListDetails,
  "loader-2": IconLoader2,
  microscope: IconMicroscope,
  moon: IconMoon,
  pencil: IconPencil,
  "player-play": IconPlayerPlay,
  "report-analytics": IconReportAnalytics,
  scale: IconScale,
  search: IconSearch,
  settings: IconSettings,
  sitemap: IconSitemap,
  sun: IconSun,
  table: IconTable,
};

export function Icon({ name, className }: { name: string; className?: string }) {
  const key = name.startsWith("ti-") ? name.slice(3) : name;
  const Comp = ICONS[key];

  if (!Comp) return null;

  return <Comp width="1em" height="1em" stroke={1.75} aria-hidden className={className} />;
}

export default Icon;
