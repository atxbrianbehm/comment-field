import { Camera, Clapperboard, Download, Layers3, Palette, Play, Sparkles, X } from "lucide-react";
import { useEffect } from "react";

const guides = [
  {
    icon: Layers3,
    title: "Field",
    summary: "Arrange the whole comment world.",
    items: [
      ["Camera / Overview", "Camera is the shot frame. Overview is always available (even 1-screen) and zooms out so posts past the canvas still show."],
      ["Arrange", "Select a card, drag its body to move it, use corner handles to scale, and the top handle to rotate."],
      ["Multi-select", "Shift-click, marquee empty space, or Ctrl/Cmd+A for all posts. Drag any selected card to move the group."],
      ["Undo / Redo", "Ctrl+Z undoes the last project change. Ctrl+Y or Ctrl+Shift+Z redoes. Dragging cards is one undo step."],
      ["Overview pan", "Alt-drag or middle-mouse pans the field. Empty drag marquees. Cmd/Ctrl is reserved for multi-select."],
      ["Record build", "Draw through cards to author their trigger order and timing."],
      ["Tweet population", "Build can keep the field alive with seeded life spans, exits, returns, size/depth variation, and a post-hero bloom. The client-note preset is a strong starting point."],
      ["Layout / Build / Hero", "Layout controls final placement. Build controls arrivals and the independent opacity curve. Hero controls the featured post and reflow."],
    ],
  },
  {
    icon: Palette,
    title: "Design",
    summary: "Style one representative post.",
    items: [
      ["Shared template", "Every design edit updates all comments and both aspect ratios."],
      ["Visibility", "Hide avatar, name, handle, timestamp, or engagement without changing the imported copy."],
      ["Surface", "Card opacity affects the fill only. Stroke width and color create the border."],
      ["Scene depth", "Soft shadow adds a depth-aware shadow layer behind every card. Card lighting adds ambient, directional, and edge light without rebuilding card textures."],
    ],
  },
  {
    icon: Clapperboard,
    title: "Animate",
    summary: "Shape motion at the shared and shot level.",
    items: [
      ["Shared entrance", "The path and transform curve are reused by every ordinary card; trigger times remain take-specific."],
      ["Shared exit", "The Out workspace has its own line, timing curve, fade, blur, scale, rotation, and depth. Choose one shared line or seeded scattered lines."],
      ["Multi-screen field", "Layout → Multi-screen field. Use Vertical 1×3 for one column of screens, then Animate → Camera to pan."],
      ["Move the camera", "Animate → Camera. Drag the field map, or use Pan X / Pan Y / Dolly, then Add keyframe at the playhead."],
      ["Transparent PNG export", "Check Alpha next to Export PNGs to write cards over a clear plate with no background."],
      ["Hero still", "Field → Hero → Export hero still downloads a flat PNG of the assigned hero card."],
      ["Opacity curve", "Open Field → Build to shape only the fade-in. Fade amount controls how transparent each card starts."],
      ["Camera", "Camera keys pan, dolly, and change FOV. Card depth creates parallax during the move."],
      ["Hero path", "Hero keys animate the featured post above every ordinary card."],
    ],
  },
];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="help-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <header className="help-header">
          <div>
            <span>Comment Field guide</span>
            <h1 id="help-title">What everything does</h1>
            <p>Start with a workspace, then use the timeline to shape when the shot changes.</p>
          </div>
          <button className="help-close" type="button" onClick={onClose} aria-label="Close help" autoFocus><X size={19} /></button>
        </header>
        <div className="help-guide-grid">
          {guides.map(({ icon: Icon, title, summary, items }) => (
            <article className="help-guide" key={title}>
              <div className="help-guide-title"><Icon size={18} /><div><h2>{title}</h2><p>{summary}</p></div></div>
              <dl>{items.map(([term, description]) => <div key={term}><dt>{term}</dt><dd>{description}</dd></div>)}</dl>
            </article>
          ))}
        </div>
        <div className="help-quick-row">
          <div><Play size={16} /><span><strong>RAM preview</strong> caches proxy frames so Play can stay at full speed.</span></div>
          <div><Camera size={16} /><span><strong>Auto-key</strong> creates camera or hero keys when you edit on an unkeyed frame.</span></div>
          <div><Sparkles size={16} /><span><strong>Rebuild preview</strong> refreshes cached playback after visual changes.</span></div>
          <div><Download size={16} /><span><strong>Export PNGs</strong> always uses the deterministic production renderer.</span></div>
        </div>
      </section>
    </div>
  );
}
