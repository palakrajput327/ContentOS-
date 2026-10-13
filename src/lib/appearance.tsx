import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'dark' | 'light';
const storageKey = 'contentos-appearance';
function initialTheme(): Theme {
  try { const saved = localStorage.getItem(storageKey); if (saved === 'light' || saved === 'dark') return saved; } catch { /* Storage may be unavailable in private browsers. */ }
  return 'dark';
}
const AppearanceContext = createContext<{theme:Theme;toggle:()=>void}>({theme:'dark',toggle:()=>{}});
export function AppearanceProvider({children}:{children:ReactNode}) {
  const [theme,setTheme] = useState<Theme>(initialTheme);
  useEffect(()=>{
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='light'?'#f6f7fb':'#0e1017');
    try { localStorage.setItem(storageKey,theme); } catch { /* Theme remains usable without storage. */ }
  },[theme]);
  return <AppearanceContext.Provider value={{theme,toggle:()=>setTheme(t=>t==='dark'?'light':'dark')}}>{children}</AppearanceContext.Provider>;
}
export const useAppearance = () => useContext(AppearanceContext);
export function ThemeToggle() {
  const {theme,toggle} = useAppearance();
  return <button type="button" className="icon-button theme-toggle" onClick={toggle} aria-label={`Switch to ${theme==='dark'?'light':'dark'} mode`} title={`Switch to ${theme==='dark'?'light':'dark'} mode`}>
    {theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}<span className="sr-only">Appearance</span>
  </button>;
}
