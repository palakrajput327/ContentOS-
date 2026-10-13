import { useEffect, type RefObject } from 'react';

export function useScrollReveal(ref:RefObject<HTMLElement|null>) {
  useEffect(()=>{
    const root=ref.current;
    if (!root || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const sections = root.querySelectorAll<HTMLElement>('.section,.final-cta');
    const observer = new IntersectionObserver(entries=>{
      entries.forEach(entry=>{ if(entry.isIntersecting){ entry.target.classList.add('is-visible');observer.unobserve(entry.target); } });
    },{threshold:.06,rootMargin:'0px 0px 24px 0px'});
    sections.forEach(section=>{ section.classList.add('reveal-section');observer.observe(section); });
    return ()=>{observer.disconnect();sections.forEach(section=>section.classList.remove('reveal-section'));};
  },[ref]);
}
