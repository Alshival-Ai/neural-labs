import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function BaseIcon(props: IconProps & { children: React.ReactNode }) {
  const { children, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 7.5h6l2 2H21v7.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3 7.5v-.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v.5" />
    </BaseIcon>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M14 3v5h5" />
    </BaseIcon>
  );
}

export function TerminalIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
      <path d="m7 10 3 2-3 2" />
      <path d="M13 16h4" />
    </BaseIcon>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" />
    </BaseIcon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M10.7 2.8h2.6l.5 2a7.8 7.8 0 0 1 1.8.8l1.8-1.1 1.9 1.9-1.1 1.8c.3.6.6 1.2.8 1.8l2 .5v2.6l-2 .5a7.8 7.8 0 0 1-.8 1.8l1.1 1.8-1.9 1.9-1.8-1.1a7.8 7.8 0 0 1-1.8.8l-.5 2h-2.6l-.5-2a7.8 7.8 0 0 1-1.8-.8l-1.8 1.1-1.9-1.9 1.1-1.8a7.8 7.8 0 0 1-.8-1.8l-2-.5v-2.6l2-.5c.2-.6.5-1.2.8-1.8L4.6 6.4l1.9-1.9 1.8 1.1c.6-.3 1.2-.6 1.8-.8z" />
      <circle cx="12" cy="12" r="3.3" />
    </BaseIcon>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M5 12h14" />
    </BaseIcon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M6 6 18 18" />
      <path d="M18 6 6 18" />
    </BaseIcon>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M20 6v6h-6" />
      <path d="M20 12a8 8 0 1 1-2.3-5.7L20 8.6" />
    </BaseIcon>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 16V5" />
      <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
      <path d="M5 19h14" />
    </BaseIcon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </BaseIcon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m15 18-6-6 6-6" />
    </BaseIcon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m9 18 6-6-6-6" />
    </BaseIcon>
  );
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m18 15-6-6-6 6" />
    </BaseIcon>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m21 16-5.5-5.5L7 19" />
    </BaseIcon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 7h16" />
      <path d="M10 3h4" />
      <path d="M7 7l1 13h8l1-13" />
    </BaseIcon>
  );
}

export function SidebarIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M9 5v14" />
    </BaseIcon>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 19V5" />
      <path d="m7 10 5-5 5 5" />
    </BaseIcon>
  );
}

export function MicrophoneIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="9" y="4" width="6" height="10" rx="3" />
      <path d="M6.5 11a5.5 5.5 0 1 0 11 0" />
      <path d="M12 16v4" />
    </BaseIcon>
  );
}

export function PaperclipIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m9.5 12.5 5.4-5.4a3 3 0 1 1 4.2 4.2l-7.4 7.4a5 5 0 1 1-7.1-7.1l7-7" />
    </BaseIcon>
  );
}

export function MaximizeIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
    </BaseIcon>
  );
}

export function FoldIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M8 6.5h9.5V16" />
      <path d="M16 8H6.5v9.5" />
    </BaseIcon>
  );
}
