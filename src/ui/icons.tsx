/**
 * Central icon module — every icon in the app is imported from here.
 *
 * The rule, from the approved design: an icon that is off is a white outline, one that is on
 * is filled. Shapes that can be filled (home, heart, microphone, gear) fill in; line glyphs
 * that cannot (shuffle, repeat, queue, download) turn into a filled square with the glyph cut
 * out of it. Actions with no on state (play, next, search) are drawn one way only.
 *
 * The app's own glyphs are drawn here. The rest come from Lucide at the same stroke width so
 * they sit in the same family. `*ActiveIcon` exports are the on state.
 */

import { useId, type ComponentType, type ReactNode, type SVGProps } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  Bug,
  Clock,
  Coffee,
  Compass,
  Copy,
  Disc3,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  FolderPlus,
  Gauge,
  Globe,
  HeartCrack,
  Image,
  Key,
  Link,
  List,
  ListMusic,
  ListPlus,
  LogIn,
  LogOut,
  Music,
  Palette,
  Pencil,
  Radio,
  Save,
  Star,
  ThumbsDown,
  Trash2,
  User,
  UserPlus,
  WandSparkles,
  type LucideProps,
} from "lucide-react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & { size?: number | string };
type IconComponent = (props: IconProps) => ReactNode;

const STROKE = 1.75;

function Svg({ size = 24, strokeWidth = STROKE, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/**
 * The on state of a line glyph: a filled square with the glyph cut out.
 *
 * A mask rather than a second colour, so the cut-out shows whatever surface the button sits
 * on instead of guessing its colour.
 */
function Tile({ size = 24, children, strokeWidth: _ignored, ...props }: IconProps & { children: ReactNode }) {
  const id = useId();
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...props}>
      <defs>
        <mask id={id}>
          <rect width="24" height="24" fill="white" />
          <g
            transform="translate(12 12) scale(0.72) translate(-12 -12)"
            fill="none"
            stroke="black"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            color="black"
          >
            {children}
          </g>
        </mask>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="3" fill="currentColor" mask={`url(#${id})`} />
    </svg>
  );
}

const line = (d: string): IconComponent => (props) => <Svg {...props}><path d={d} /></Svg>;
const filled = (d: string): IconComponent => (props) => <Svg {...props}><path d={d} fill="currentColor" /></Svg>;
const tile = (d: string): IconComponent => (props) => <Tile {...props}><path d={d} /></Tile>;

function lucide(Icon: ComponentType<LucideProps>, extra?: LucideProps): IconComponent {
  return ({ size = 24, strokeWidth = STROKE, ...props }) => (
    <Icon size={size} strokeWidth={strokeWidth} aria-hidden="true" {...extra} {...(props as LucideProps)} />
  );
}

function lucideTile(Icon: ComponentType<LucideProps>): IconComponent {
  return (props) => (
    <Tile {...props}>
      <Icon x={0} y={0} width={24} height={24} color="black" strokeWidth={2.4} />
    </Tile>
  );
}

/* ── Glyphs from the approved design ───────────────────────────────── */
const HOME = "M4 10.2 12 4l8 6.2V20h-5v-5.5H9V20H4z";
const LIBRARY = "M4.5 4.5H8v15H4.5zM10.25 4.5h3.5v15h-3.5zM15.6 5.4l3.2-.9 3.4 14.6-3.2.9z";
const DOWNLOADS = "M12 4.5V14M8.25 10.5 12 14.25l3.75-3.75M4.5 15.5v3a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-3";
const DOWNLOAD_ARROW = "M12 7.5v8M8.75 12.5 12 15.75l3.25-3.25";
const GEAR =
  "M18.95 10.14 21.51 10.66 21.51 13.34 18.95 13.86 18.24 15.6 19.67 17.78 17.78 19.67 15.6 18.24 13.86 18.95 13.34 21.51 10.66 21.51 10.14 18.95 8.4 18.24 6.22 19.67 4.33 17.78 5.76 15.6 5.05 13.86 2.49 13.34 2.49 10.66 5.05 10.14 5.76 8.4 4.33 6.22 6.22 4.33 8.4 5.76 10.14 5.05 10.66 2.49 13.34 2.49 13.86 5.05 15.6 5.76 17.78 4.33 19.67 6.22 18.24 8.4Z";
const GEAR_HOLE = "M15 12a3 3 0 1 0-6 0 3 3 0 1 0 6 0z";
const SHUFFLE =
  "M4 7h3.2c1.6 0 3 .8 3.9 2.1l3.8 5.8c.9 1.3 2.3 2.1 3.9 2.1H20M4 17h3.2c1.6 0 3-.8 3.9-2.1M14.9 9.1C15.8 7.8 17.2 7 18.8 7H20M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5";
const REPEAT = "M5 11V9a2 2 0 0 1 2-2h12M16.5 4.5 19 7l-2.5 2.5M19 13v2a2 2 0 0 1-2 2H5M7.5 19.5 5 17l2.5-2.5";
const REPEAT_ONE = `${REPEAT}M11.2 10.6l1.1-.6v4`;
const HEART = "M12 19.5s-7.5-4.4-7.5-9.6A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 2.3c0 5.2-7.5 9.6-7.5 9.6z";
const MIC_STAND = "M6 11a6 6 0 0 0 12 0M12 17v3.5M9 20.5h6";
const QUEUE = "M4 6.5h16M4 11.5h16M4 16.5h8.5M15.5 14v6l4.5-3z";
const SEARCH = "M10.5 4.5a6 6 0 1 0 0 12 6 6 0 1 0 0-12zM15 15l5 5";
const PLAY = "M8 5.5v13l10.5-6.5z";
const SPEAKER = "M4 9.5h3.5L12 5.5v13l-4.5-4H4z";
const VOLUME_LOUD = `${SPEAKER}M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11`;
const VOLUME_SMALL = `${SPEAKER}M15.5 9a4.5 4.5 0 0 1 0 6`;
const VOLUME_MUTED = `${SPEAKER}M15.5 9.5l5 5M20.5 9.5l-5 5`;
const CLOSE = "M6 6l12 12M18 6 6 18";
const CHECK = "m5 12.5 4.5 4.5L19 7.5";
const PLUS = "M12 5v14M5 12h14";
const SYNC = "M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1M17.5 3.5v3.4h-3.4M6.5 20.5v-3.4h3.4";
const FOLDER = "M3.5 6.5a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z";
const EXPAND = "M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5l-6 6M4.5 19.5l6-6";
const COLLAPSE = "M19.5 10H14V4.5M4.5 14H10v5.5M14 10l5.5-5.5M10 14l-5.5 5.5";
const BACK = "M15 5 8 12l7 7";
const FORWARD = "m9 5 7 7-7 7";
const CHEVRON_DOWN = "m6 9 6 6 6-6";

/* ── Transport (actions: one state) ────────────────────────────────── */
export const PlayIcon = filled(PLAY);
export const PlayActiveIcon = PlayIcon;
export const PauseIcon: IconComponent = (props) => (
  <Svg {...props} stroke="none">
    <rect x="6.5" y="5.5" width="3.75" height="13" rx="1" fill="currentColor" />
    <rect x="13.75" y="5.5" width="3.75" height="13" rx="1" fill="currentColor" />
  </Svg>
);
export const PauseActiveIcon = PauseIcon;
export const SkipPreviousIcon: IconComponent = (props) => (
  <Svg {...props} stroke="none">
    <path d="M18 6v12L9.5 12z" fill="currentColor" />
    <rect x="6" y="6" width="2" height="12" rx="0.5" fill="currentColor" />
  </Svg>
);
export const SkipPreviousActiveIcon = SkipPreviousIcon;
export const SkipNextIcon: IconComponent = (props) => (
  <Svg {...props} stroke="none">
    <path d="M6 6v12l8.5-6z" fill="currentColor" />
    <rect x="16" y="6" width="2" height="12" rx="0.5" fill="currentColor" />
  </Svg>
);
export const SkipNextActiveIcon = SkipNextIcon;

/* ── Playback order (toggles) ──────────────────────────────────────── */
export const ShuffleIcon = line(SHUFFLE);
export const ShuffleActiveIcon = tile(SHUFFLE);
export const RepeatIcon = line(REPEAT);
export const RepeatActiveIcon = tile(REPEAT);
export const RepeatOneIcon = line(REPEAT_ONE);
export const RepeatOneActiveIcon = tile(REPEAT_ONE);

/* ── Volume ────────────────────────────────────────────────────────── */
export const VolumeLoudIcon = line(VOLUME_LOUD);
export const VolumeLoudActiveIcon = tile(VOLUME_LOUD);
export const VolumeSmallIcon = line(VOLUME_SMALL);
export const VolumeMutedIcon = line(VOLUME_MUTED);
export const VolumeMutedActiveIcon = tile(VOLUME_MUTED);

/* ── Library and ratings ───────────────────────────────────────────── */
export const HeartIcon = line(HEART);
export const HeartActiveIcon = filled(HEART);
export const HeartBrokenIcon = lucide(HeartCrack);
export const DislikeIcon = lucide(ThumbsDown);
export const DislikeActiveIcon = lucide(ThumbsDown, { fill: "currentColor" });
export const BookmarkIcon = lucide(Bookmark);
export const BookmarkActiveIcon = lucide(Bookmark, { fill: "currentColor" });
export const StarIcon = lucide(Star);
export const StarActiveIcon = lucide(Star, { fill: "currentColor" });
export const MusicNoteIcon = lucide(Music);
export const MusicNoteActiveIcon = lucideTile(Music);
export const PlaylistIcon = lucide(ListMusic);
export const PlaylistActiveIcon = lucideTile(ListMusic);
export const PlaylistAddIcon = lucide(ListPlus);
export const AlbumIcon = lucide(Disc3);
export const AlbumActiveIcon = lucideTile(Disc3);
export const EyeIcon = lucide(Eye);
export const EyeClosedIcon = lucide(EyeOff);
export const LyricsIcon: IconComponent = (props) => (
  <Svg {...props}>
    <rect x="9" y="3.5" width="6" height="10.5" rx="3" />
    <path d={MIC_STAND} />
  </Svg>
);
export const LyricsActiveIcon: IconComponent = (props) => (
  <Svg {...props}>
    <rect x="9" y="3.5" width="6" height="10.5" rx="3" fill="currentColor" />
    <path d={MIC_STAND} />
  </Svg>
);

/* ── Files ─────────────────────────────────────────────────────────── */
export const FolderIcon = line(FOLDER);
export const FolderOpenIcon = lucide(FolderOpen);
export const FolderAddIcon = lucide(FolderPlus);
export const ImageIcon = lucide(Image);
export const LogFileIcon = lucide(FileText);

/* ── Navigation ────────────────────────────────────────────────────── */
export const HomeIcon = line(HOME);
export const HomeActiveIcon = filled(HOME);
export const LibraryIcon = line(LIBRARY);
export const LibraryActiveIcon = filled(LIBRARY);
export const DownloadsIcon = line(DOWNLOADS);
export const DownloadsActiveIcon = tile(DOWNLOAD_ARROW);
export const SettingsIcon: IconComponent = (props) => (
  <Svg {...props}>
    <path d={GEAR} />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const SettingsActiveIcon: IconComponent = (props) => (
  <Svg {...props}>
    <path d={`${GEAR}${GEAR_HOLE}`} fill="currentColor" fillRule="evenodd" />
  </Svg>
);
export const QueuePanelIcon = line(QUEUE);
export const QueuePanelActiveIcon = tile(QUEUE);
export const SearchIcon = line(SEARCH);
export const CompassIcon = lucide(Compass);
export const RadioIcon = lucide(Radio);
export const PaletteIcon = lucide(Palette);
export const PaletteActiveIcon = lucideTile(Palette);
export const ListIcon = lucide(List);
export const SortIcon = lucide(ArrowUpDown);
export const BackIcon = line(BACK);
export const ForwardIcon = line(FORWARD);
export const ChevronDownIcon = line(CHEVRON_DOWN);
export const MoreIcon: IconComponent = (props) => (
  <Svg {...props} stroke="none">
    <rect x="10.75" y="4.5" width="2.5" height="2.5" rx="0.5" fill="currentColor" />
    <rect x="10.75" y="10.75" width="2.5" height="2.5" rx="0.5" fill="currentColor" />
    <rect x="10.75" y="17" width="2.5" height="2.5" rx="0.5" fill="currentColor" />
  </Svg>
);
export const MiniPlayerIcon: IconComponent = (props) => (
  <Svg {...props}>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <rect x="11.5" y="12" width="7" height="5" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);
export const MinimizeIcon = line("M6 12h12");
export const MaximizeIcon: IconComponent = (props) => (
  <Svg {...props}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </Svg>
);

/* ── Actions ───────────────────────────────────────────────────────── */
export const CloseIcon = line(CLOSE);
export const CloseActiveIcon = tile(CLOSE);
export const FullScreenIcon = line(EXPAND);
export const QuitFullScreenIcon = line(COLLAPSE);
export const PlusIcon = line(PLUS);
export const CheckIcon = line(CHECK);
export const CheckActiveIcon = tile(CHECK);
export const RefreshIcon = line(SYNC);
export const TrashIcon = lucide(Trash2);
export const CopyIcon = lucide(Copy);
export const PencilIcon = lucide(Pencil);
export const LinkIcon = lucide(Link);
export const ArrowUpIcon = lucide(ArrowUp);
export const ArrowDownIcon = lucide(ArrowDown);
export const ArrowLeftIcon = lucide(ArrowLeft);
export const ArrowRightIcon = lucide(ArrowRight);

/* ── Downloads ─────────────────────────────────────────────────────── */
export const DownloadIcon: IconComponent = (props) => (
  <Svg {...props}>
    <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="2.5" />
    <path d={DOWNLOAD_ARROW} />
  </Svg>
);
export const DownloadActiveIcon = tile(DOWNLOAD_ARROW);

/**
 * A download in progress: the square fills from the bottom. A square rather than a ring,
 * because the design has no circles.
 */
export function DownloadProgressIcon({ progress = 0, ...props }: IconProps & { progress?: number }) {
  const height = 11 * Math.max(0, Math.min(1, progress));
  return (
    <Svg {...props}>
      <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="2.5" />
      <rect x="6.5" y={6.5 + 11 - height} width="11" height={height} rx="0.75" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/* ── Account and system ────────────────────────────────────────────── */
export const UserIcon = lucide(User);
export const UserActiveIcon = lucide(User, { fill: "currentColor" });
export const UserPlusIcon = lucide(UserPlus);
export const LoginIcon = lucide(LogIn);
export const GlobalIcon = lucide(Globe);
export const LogoutIcon = lucide(LogOut);
export const KeyIcon = lucide(Key);
export const BugIcon = lucide(Bug);
export const ClockIcon = lucide(Clock);
export const SpeedIcon = lucide(Gauge);
export const EqualizerIcon: IconComponent = (props) => (
  <Svg {...props}>
    <path d="M6 4v16M12 4v16M18 4v16" />
    <rect x="4" y="13" width="4" height="3" rx="0.5" fill="currentColor" />
    <rect x="10" y="7" width="4" height="3" rx="0.5" fill="currentColor" />
    <rect x="16" y="11" width="4" height="3" rx="0.5" fill="currentColor" />
  </Svg>
);
export const SaveIcon = lucide(Save);
export const CoffeeIcon = lucide(Coffee);
export const DiceIcon = lucide(WandSparkles);
export const DiceActiveIcon = lucideTile(WandSparkles);


/**
 * YouTube Music brand mark.
 *
 * Same reasoning as `GitHubIcon` and `LastFmIcon`: icon sets ship no brand marks, and the header
 * indicator has to be recognisable as YouTube Music rather than a generic play glyph sitting
 * next to the Last.fm and Discord marks.
 * Path from Simple Icons (CC0), sized and coloured like the other icons.
 */
export function YouTubeMusicIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zm0 19.104c-3.924 0-7.104-3.18-7.104-7.104S8.076 4.896 12 4.896s7.104 3.18 7.104 7.104-3.18 7.104-7.104 7.104zm0-13.332c-3.432 0-6.228 2.796-6.228 6.228S8.568 18.228 12 18.228s6.228-2.796 6.228-6.228S15.432 5.772 12 5.772zM9.6 15.6V8.4l6 3.6-6 3.6z" />
    </svg>
  );
}

/**
 * GitHub brand mark.
 *
 * Same reasoning as `LastFmIcon` below: An icon set ships no brand marks, and a brand mark has to
 * stay recognisable rather than be approximated by a generic glyph.
 * Path from Simple Icons (CC0), sized and coloured like the other icons.
 */
export function GitHubIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/**
 * Google "G" mark, in its four brand colours.
 *
 * The one icon here that deliberately ignores `currentColor`: the G is only the G when it is
 * those four colours, and a monochrome version of it reads as a generic glyph. It sits on the
 * sign-in button, where the whole point is that it is recognisably Google's — the account
 * being signed into really is a Google account.
 * Paths are Google's published mark, sized like the other icons.
 */
export function GoogleIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      {...props}
    >
      <path
        fill="#4285F4"
        d="M23.52 12.273c0-.851-.076-1.67-.218-2.455H12v4.642h6.458a5.52 5.52 0 0 1-2.396 3.622v3.01h3.878c2.269-2.089 3.58-5.165 3.58-8.819Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.956-1.075 7.94-2.908l-3.878-3.01c-1.075.72-2.45 1.145-4.062 1.145-3.125 0-5.77-2.11-6.714-4.945H1.276v3.109A11.995 11.995 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.286 14.282A7.212 7.212 0 0 1 4.91 12c0-.792.136-1.562.376-2.282V6.609H1.276A11.995 11.995 0 0 0 0 12c0 1.936.464 3.769 1.276 5.391l4.01-3.109Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.773c1.762 0 3.344.605 4.587 1.794l3.442-3.442C17.951 1.19 15.235 0 12 0 7.309 0 3.251 2.69 1.276 6.609l4.01 3.109C6.23 6.882 8.875 4.773 12 4.773Z"
      />
    </svg>
  );
}

/**
 * Discord brand mark.
 *
 * Same reasoning as the other two brand marks here: An icon set ships none, and a brand has to stay
 * recognisable rather than be stood in for by a generic chat glyph.
 * Path from Simple Icons (CC0), sized and coloured like the other icons.
 */
export function DiscordIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}

/**
 * Last.fm brand mark.
 *
 * An icon set ships no brand marks, and a brand mark must stay recognisable — so this one stays
 * a hand-rolled SVG rather than being approximated by a generic music glyph.
 * Path from Simple Icons (CC0). Sized and coloured like the other icons so it drops into the same slots.
 */
export function LastFmIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.42 0 3.189 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.62-3.932l-1.757-.385c-1.21-.275-1.567-.77-1.567-1.594 0-.934.742-1.485 1.952-1.485 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.602l1.87.44c1.402.33 1.869.907 1.869 1.694 0 1.017-.99 1.43-2.86 1.43-2.776 0-3.93-1.457-4.59-3.464l-.907-2.749c-1.155-3.573-3-4.893-6.653-4.893C2.008 5.977 0 8.424 0 12.597c0 4.013 2.063 6.184 5.774 6.184 2.997 0 4.435-1.402 4.435-1.402l.375-.169z" />
    </svg>
  );
}
