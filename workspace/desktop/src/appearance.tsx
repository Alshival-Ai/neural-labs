import { createContext, useContext, useRef, useState } from "react";
import { deviceStateKey } from "./deviceState";

export type Theme = "light" | "dark";
export function normalizeTheme(value: unknown): Theme { return value === "dark" ? "dark" : "light"; }
export function wallpaperKey(userId: string) { return deviceStateKey(userId, "wallpaper"); }
export function validWallpaper(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 2_800_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : undefined;
}
export const AppearanceContext = createContext<{
  theme: Theme; setTheme: (value: Theme) => void; wallpaper?: string; setWallpaper: (value?: string) => void;
}>({ theme: "light", setTheme: () => {}, setWallpaper: () => {} });

export function AppearanceControls() {
  const { theme, setTheme, wallpaper, setWallpaper } = useContext(AppearanceContext);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const upload = useRef(0);
  const choose = async (file?: File) => {
    if (!file) return;
    const generation = ++upload.current;
    setError(undefined);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2 * 1024 ** 2 || !file.size) {
      setError("Choose a PNG, JPEG, or WebP image under 2 MB."); return;
    }
    setLoading(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("The image could not be read."));
        reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file);
      });
      await new Promise<void>((resolve, reject) => {
        const image = new Image(); image.onload = () => resolve(); image.onerror = () => reject(new Error("This image could not be opened.")); image.src = data;
      });
      if (generation === upload.current) setWallpaper(data);
    } catch (error) { if (generation === upload.current) setError(error instanceof Error ? error.message : "The wallpaper could not be saved."); }
    finally { if (generation === upload.current) setLoading(false); }
  };
  return <section className="settings-card user-settings-card appearance-controls" aria-label="Desktop appearance">
    <div className="user-settings-card__heading"><div><span>Appearance</span><h3>Theme and wallpaper</h3><p>Personal to your account on this device.</p></div></div>
    <fieldset><legend>Theme</legend><div className="settings-actions">
      {(["light", "dark"] as const).map(value => <button key={value} type="button" className={`settings-button${theme === value ? " is-primary" : ""}`} aria-pressed={theme === value} onClick={() => setTheme(value)}>{value === "light" ? "Light" : "Dark"}</button>)}
    </div></fieldset>
    <img className="appearance-wallpaper-preview" src={wallpaper || (theme === "dark" ? "/workspace/assets/wallpaper-dark.webp" : "/workspace/assets/wallpaper.png")} alt={wallpaper ? "Your custom wallpaper" : `${theme === "dark" ? "Dark" : "Light"} Neural Labs wallpaper`} />
    <label>Custom wallpaper<input type="file" accept="image/png,image/jpeg,image/webp" disabled={loading} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ""; }} /></label>
    <p>PNG, JPEG, or WebP, up to 2 MB. Stored in your browser.</p>
    {loading && <p role="status">Saving wallpaper…</p>}
    {wallpaper && <button type="button" className="settings-button" disabled={loading} onClick={() => { try { setWallpaper(undefined); setError(undefined); } catch (error) { setError(error instanceof Error ? error.message : "The wallpaper could not be reset."); } }}>Use Neural Labs wallpaper</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
