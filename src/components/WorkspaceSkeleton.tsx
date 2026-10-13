export default function WorkspaceSkeleton() {
  return <div className="workspace-skeleton" role="status" aria-label="Loading your workspace" aria-busy="true">
    <span className="sr-only">Loading your workspace…</span>
    <div className="skeleton skeleton-kicker"/><div className="skeleton skeleton-heading"/>
    <div className="skeleton-stats">{[0,1,2,3].map(i=><div className="skeleton skeleton-card" key={i}/>)}</div>
    <div className="skeleton-panels"><div className="skeleton"/><div className="skeleton"/></div>
  </div>;
}
