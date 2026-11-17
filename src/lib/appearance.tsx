import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

type Theme = 'dark' | 'light';
type Preference = Theme | 'system';
const storageKey = 'contentos-appearance';
function initialPreference(): Preference {
  try { const saved = localStorage.getItem(storageKey); if (saved === 'light' || saved === 'dark') return saved; } catch { /* Storage is optional. */ }
  return 'system';
}
const AppearanceContext = createContext<{theme:Theme;preference:Preference;toggle:()=>void}>({theme:'light',preference:'system',toggle:()=>{}});
export function AppearanceProvider({children}:{children:ReactNode}) {
  const [preference,setPreference] = useState<Preference>(initialPreference);
  const [systemDark,setSystemDark] = useState(()=>window.matchMedia('(prefers-color-scheme: dark)').matches);
  const theme:Theme = preference==='system' ? systemDark?'dark':'light' : preference;
  useEffect(()=>{
    const media=window.matchMedia('(prefers-color-scheme: dark)');
    const update=()=>setSystemDark(media.matches);
    media.addEventListener('change',update);
    const sync=(event:StorageEvent)=>{if(event.key===storageKey)setPreference(initialPreference());};
    window.addEventListener('storage',sync);
    return ()=>{media.removeEventListener('change',update);window.removeEventListener('storage',sync);};
  },[]);
  useEffect(()=>{
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='light'?'#f8fafc':'#0b0f17');
    try { localStorage.setItem(storageKey,preference); } catch { /* Theme remains usable without storage. */ }
  },[theme,preference]);
  return <AppearanceContext.Provider value={{theme,preference,toggle:()=>setPreference(p=>p==='system'?'light':p==='light'?'dark':'system')}}>{children}</AppearanceContext.Provider>;
}
export const useAppearance = () => useContext(AppearanceContext);
export function ThemeToggle() {
  const {preference,toggle} = useAppearance();
  const next=preference==='system'?'light':preference==='light'?'dark':'system';
  return <button type="button" className="icon-button theme-toggle" onClick={toggle} aria-label={`Appearance: ${preference}. Switch to ${next} mode`} title={`Appearance: ${preference}. Switch to ${next} mode`}>
    {preference==='system'?<Monitor size={18}/>:preference==='dark'?<Moon size={18}/>:<Sun size={18}/>}<span className="sr-only">Appearance</span>
  </button>;
}
