import fs from 'node:fs';

let code = fs.readFileSync('src/pages/KnowledgeAutomation.tsx', 'utf8').replace(/\r\n/g, '\n');

// 1. Update Config type to include poster_style
code = code.replace(
  `  posting_time?: string;\n  last_message?: string;`,
  `  posting_time?: string;\n  poster_style?: 'DIRECT' | 'BRANDED_CANVAS';\n  last_message?: string;`
);

// 2. Add posterStyle in save payload
code = code.replace(
  `          platforms: config.platforms,\n          postingTime: config.posting_time || "10:00",\n        });`,
  `          platforms: config.platforms,\n          postingTime: config.posting_time || "10:00",\n          posterStyle: config.poster_style || "DIRECT",\n        });`
);

// 3. Update Hero Controls: Add Master Toggle, Time Slot, and Poster Style
const heroControlsTarget = `          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              <label className="ka-autopilot-select-label">
                ⏰ Daily Post Slot
              </label>
              <select
                aria-label="Daily Post Slot Time"
                className="ka-autopilot-select"
                value={config?.posting_time || "10:00"}
                disabled={!data?.canManage || busy}
                onChange={(e) => {
                  const newTime = e.target.value;
                  change({ posting_time: newTime });
                  if (config) {
                    action(
                      () =>
                        request(base + "/settings", "PATCH", {
                          enabled: config.enabled,
                          horizonDays: config.horizon_days,
                          cooldownDays: config.cooldown_days,
                          platforms: config.platforms,
                          postingTime: newTime,
                        }),
                      \`Daily posting slot set to \${newTime}!\`,
                    );
                  }
                }}
              >
                <option value="08:00">08:00 AM</option>
                <option value="09:00">09:00 AM</option>
                <option value="10:00">10:00 AM (Recommended)</option>
                <option value="11:00">11:00 AM</option>
                <option value="12:00">12:00 PM</option>
                <option value="14:00">02:00 PM</option>
                <option value="16:00">04:00 PM</option>
                <option value="18:00">06:00 PM</option>
                <option value="20:00">08:00 PM</option>
              </select>
            </div>

            <button
              type="button"
              className="ka-autopilot-btn"
              disabled={busy || !data?.canEdit}
              onClick={triggerAutoPilot}
              style={{ alignSelf: "flex-end" }}
            >
              <Zap size={16} />
              {busy ? "Running Auto-Pilot…" : "⚡ Run Auto-Pilot Now"}
            </button>
          </div>`;

const heroControlsRep = `          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            {/* Master Toggle Button */}
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              <span className="ka-autopilot-select-label">⚡ Auto-Pilot Status</span>
              <button
                type="button"
                disabled={!data?.canManage || busy}
                onClick={() => save(!config?.enabled)}
                style={{
                  height: "38px",
                  padding: "0 14px",
                  borderRadius: "8px",
                  fontWeight: 700,
                  fontSize: "0.82rem",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: config?.enabled ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.15)",
                  color: config?.enabled ? "#34d399" : "#fca5a5",
                  border: config?.enabled ? "1px solid rgba(16, 185, 129, 0.4)" : "1px solid rgba(239, 68, 68, 0.3)",
                }}
              >
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: config?.enabled ? "#10b981" : "#ef4444" }} />
                {config?.enabled ? "ACTIVE (Running)" : "PAUSED (Click to Turn On)"}
              </button>
            </div>

            {/* Poster Style Selector */}
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              <label className="ka-autopilot-select-label">🎨 Poster Visual Style</label>
              <select
                aria-label="Poster Visual Style"
                className="ka-autopilot-select"
                value={config?.poster_style || "DIRECT"}
                disabled={!data?.canManage || busy}
                onChange={(e) => {
                  const style = e.target.value as 'DIRECT' | 'BRANDED_CANVAS';
                  change({ poster_style: style });
                  if (config) {
                    action(
                      () =>
                        request(base + "/settings", "PATCH", {
                          enabled: config.enabled,
                          horizonDays: config.horizon_days,
                          cooldownDays: config.cooldown_days,
                          platforms: config.platforms,
                          postingTime: config.posting_time || "10:00",
                          posterStyle: style,
                        }),
                      \`Poster style set to \${style === 'DIRECT' ? 'Direct PDF Slide' : 'Branded Canvas Poster'}!\`
                    );
                  }
                }}
              >
                <option value="DIRECT">🖼️ Direct PDF Slide (Clean)</option>
                <option value="BRANDED_CANVAS">🎨 Branded Canvas Poster (Framed + CTA)</option>
              </select>
            </div>

            {/* Daily Post Slot Time */}
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              <label className="ka-autopilot-select-label">⏰ Daily Post Slot</label>
              <select
                aria-label="Daily Post Slot Time"
                className="ka-autopilot-select"
                value={config?.posting_time || "10:00"}
                disabled={!data?.canManage || busy}
                onChange={(e) => {
                  const newTime = e.target.value;
                  change({ posting_time: newTime });
                  if (config) {
                    action(
                      () =>
                        request(base + "/settings", "PATCH", {
                          enabled: config.enabled,
                          horizonDays: config.horizon_days,
                          cooldownDays: config.cooldown_days,
                          platforms: config.platforms,
                          postingTime: newTime,
                          posterStyle: config.poster_style || "DIRECT",
                        }),
                      \`Daily posting slot set to \${newTime}!\`
                    );
                  }
                }}
              >
                <option value="08:00">08:00 AM</option>
                <option value="09:00">09:00 AM</option>
                <option value="10:00">10:00 AM (Recommended)</option>
                <option value="11:00">11:00 AM</option>
                <option value="12:00">12:00 PM</option>
                <option value="14:00">02:00 PM</option>
                <option value="16:00">04:00 PM</option>
                <option value="18:00">06:00 PM (Target Slot)</option>
                <option value="20:00">08:00 PM</option>
              </select>
            </div>

            <button
              type="button"
              className="ka-autopilot-btn"
              disabled={busy || !data?.canEdit}
              onClick={triggerAutoPilot}
              style={{ alignSelf: "flex-end" }}
            >
              <Zap size={16} />
              {busy ? "Running Auto-Pilot…" : "⚡ Run Auto-Pilot Now"}
            </button>
          </div>`;

code = code.replace(heroControlsTarget, heroControlsRep);

// 4. Update Plan Card to render poster thumbnail & "Publish Now" button
const planCardTarget = `                      {data.plans.map((p) => (
                        <article className="ka-plan" key={p.id}>
                          <div>
                            <h3>{p.title || p.source_snapshot.key}</h3>
                            <p>Proposed: {date(p.proposed_at)}</p>
                            <small>
                              {p.source_snapshot.sources
                                ?.map((s) => s.documentName)
                                .filter((v, i, a) => a.indexOf(v) === i)
                                .join(", ")}
                            </small>
                            {p.error_message && (
                              <p className="ka-error">
                                {p.error_message} · Attempt {p.attempts}/3
                              </p>
                            )}
                          </div>
                          <div className="ka-plan-actions">
                            <StatusBadge
                              status={
                                p.state === "REVIEW"
                                  ? p.content_status
                                  : p.state
                              }
                            />
                            {p.content_id && (
                              <Button asChild>
                                <Link to={\`/app/compose?id=\${p.content_id}\`}>
                                  Review & edit
                                </Link>
                              </Button>
                            )}`;

const planCardRep = `                      {data.plans.map((p) => {
                        const mediaUrl = (p as any).variants ? Object.values((p as any).variants).find((v: any) => v?.mediaUrl)?.mediaUrl : null;
                        const cleanTitle = p.title && !p.title.startsWith('{') ? p.title : (p.source_snapshot?.value || p.source_snapshot?.key || "Social Media Post");
                        return (
                        <article className="ka-plan" key={p.id} style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                          {mediaUrl && (
                            <img
                              src={mediaUrl}
                              alt="Poster Thumbnail"
                              style={{
                                width: "64px",
                                height: "64px",
                                objectFit: "cover",
                                borderRadius: "8px",
                                border: "1px solid var(--border)",
                                flexShrink: 0,
                              }}
                            />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <h3 style={{ margin: "0 0 4px", fontSize: "0.95rem" }}>{cleanTitle}</h3>
                            <p style={{ margin: "0 0 2px", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>Proposed: {date(p.proposed_at)}</p>
                            <small style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                              {p.source_snapshot.sources
                                ?.map((s) => s.documentName)
                                .filter((v, i, a) => a.indexOf(v) === i)
                                .join(", ")}
                            </small>
                            {p.error_message && (
                              <p className="ka-error" style={{ margin: "4px 0 0" }}>
                                {p.error_message} · Attempt {p.attempts}/3
                              </p>
                            )}
                          </div>
                          <div className="ka-plan-actions" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <StatusBadge
                              status={
                                p.state === "REVIEW"
                                  ? p.content_status
                                  : p.state
                              }
                            />
                            {p.content_id && p.content_status === "SCHEDULED" && data.canManage && (
                              <Button
                                disabled={busy}
                                onClick={() =>
                                  action(
                                    async () => {
                                      await request(\`\${base}/plans/\${p.id}/publish-now\`, "POST");
                                      await query.invalidateQueries({ queryKey: ["knowledge-automation"] });
                                    },
                                    "🚀 Post successfully published to all connected social channels!"
                                  )
                                }
                                style={{
                                  background: "linear-gradient(135deg, #10b981, #059669)",
                                  color: "#fff",
                                  fontSize: "0.8rem",
                                  padding: "6px 12px",
                                  fontWeight: 600,
                                }}
                              >
                                🚀 Publish Now
                              </Button>
                            )}
                            {p.content_id && (
                              <Button asChild>
                                <Link to={\`/app/compose?id=\${p.content_id}\`}>
                                  Review & edit
                                </Link>
                              </Button>
                            )}`;

code = code.replace(planCardTarget, planCardRep);

// Close map arrow function correctly
code = code.replace(
  `                            {p.content_id && (
                              <Button asChild>
                                <Link to={\`/app/compose?id=\${p.content_id}\`}>
                                  Review & edit
                                </Link>
                              </Button>
                            )}
                            {data.canManage &&
                              p.state === "FAILED" &&
                              !p.content_id && (
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    action(
                                      () =>
                                        request(
                                          \`\${base}/plans/\${p.id}/retry\`,
                                          "POST",
                                          {},
                                        ),
                                      "Generation retry requested. Enable automation to process it.",
                                    )
                                  }
                                >
                                  Retry idea
                                </Button>
                              )}
                          </div>
                        </article>
                      ))}`,
  `                            {p.content_id && (
                              <Button asChild>
                                <Link to={\`/app/compose?id=\${p.content_id}\`}>
                                  Review & edit
                                </Link>
                              </Button>
                            )}
                            {data.canManage &&
                              p.state === "FAILED" &&
                              !p.content_id && (
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    action(
                                      () =>
                                        request(
                                          \`\${base}/plans/\${p.id}/retry\`,
                                          "POST",
                                          {},
                                        ),
                                      "Generation retry requested. Enable automation to process it.",
                                    )
                                  }
                                >
                                  Retry idea
                                </Button>
                              )}
                          </div>
                        </article>
                        );
                      })}`
);

fs.writeFileSync('src/pages/KnowledgeAutomation.tsx', code, 'utf8');
console.log('Successfully updated KnowledgeAutomation.tsx!');
