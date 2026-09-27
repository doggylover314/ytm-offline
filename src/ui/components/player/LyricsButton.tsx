import { LyricsActiveIcon, LyricsIcon } from "@/ui/icons";
import { usePlayerSelector } from "../../../player/playerStore";
import { usePlayerUIState } from "../../stores/playerUIStore";
import { PLAYER_ICON_BUTTON } from "./playerButton";

interface LyricsButtonProps {
  onToggle: () => void;
}

export function LyricsButton({ onToggle }: LyricsButtonProps) {
  // The derived boolean, not the track: this only cares whether there is one, so it should
  // re-render when that flips and not on every change of song.
  const hasTrack = usePlayerSelector((state) => state.currentTrack !== null);
  const uiState = usePlayerUIState();
  const Glyph = uiState.isLyricsOpen ? LyricsActiveIcon : LyricsIcon;

  return (
    <button
      type="button"
      className={PLAYER_ICON_BUTTON}
      onClick={onToggle}
      disabled={!hasTrack}
      aria-label={uiState.isLyricsOpen ? "Close lyrics" : "Open lyrics"}
      aria-pressed={uiState.isLyricsOpen}
    >
      <Glyph size={20} />
    </button>
  );
}
