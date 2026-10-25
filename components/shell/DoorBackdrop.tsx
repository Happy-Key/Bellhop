/**
 * The Bellhop backdrop: a hotel corridor of doors behind every page. Each row is a floor (room
 * numbers 1401…), tilted slightly; alternate rows drift in opposite directions. Purely decorative
 * (aria-hidden, no pointer events), drawn with the theme tokens so it follows light and dark mode,
 * and still for people who prefer reduced motion. Styles: "Door backdrop" in app/globals.css.
 */

const ROWS = 14;
const DOORS_PER_TILE = 6;
const CELL_W = 132;
const ROW_H = 224;
const TILE_W = DOORS_PER_TILE * CELL_W;
/** Tiles per row: enough to cover the tilted, enlarged layer on wide screens while it scrolls by one tile. */
const TILES = 5;

/** A deterministic sprinkle of "Do not disturb" hangers. */
const hasHanger = (floor: number, door: number) => (floor * 7 + door * 3) % 5 === 0;

function Door({ x, number, hanger }: { x: number; number: string; hanger: boolean }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <rect className="db-plate" x={44} y={8} width={44} height={17} rx={3} />
      <text className="db-number" x={66} y={20.5} textAnchor="middle">
        {number}
      </text>
      <rect className="db-frame" x={20} y={32} width={92} height={184} rx={5} />
      <rect className="db-door" x={26} y={38} width={80} height={178} rx={3} />
      <rect className="db-panel" x={36} y={52} width={60} height={64} rx={3} />
      <rect className="db-panel" x={36} y={128} width={60} height={74} rx={3} />
      <circle className="db-peep" cx={66} cy={45} r={2.5} />
      <circle className="db-brass" cx={96} cy={124} r={4.5} />
      {hanger && (
        <g className="db-hanger">
          <path d="M90 128 h14 a2 2 0 0 1 2 2 v28 a2 2 0 0 1 -2 2 h-14 a2 2 0 0 1 -2 -2 v-28 a2 2 0 0 1 2 -2 z" />
          <circle cx={97} cy={134} r={2.6} className="db-hanger-hole" />
          <rect x={91.5} y={142} width={11} height={2} rx={1} className="db-hanger-text" />
          <rect x={91.5} y={147} width={8} height={2} rx={1} className="db-hanger-text" />
        </g>
      )}
    </g>
  );
}

export function DoorBackdrop() {
  return (
    <div className="door-backdrop" aria-hidden="true">
      <div className="db-field">
        {Array.from({ length: ROWS }, (_, r) => {
          const floor = ROWS - r + 1;
          const id = `db-floor-${floor}`;
          return (
            <div key={id} className={`db-row ${r % 2 ? "db-row-left" : "db-row-right"}`} style={{ ["--db-tile" as string]: `${TILE_W}px` }}>
              <svg width={TILE_W * TILES} height={ROW_H} viewBox={`0 0 ${TILE_W * TILES} ${ROW_H}`} focusable="false">
                <defs>
                  <g id={id}>
                    <rect className="db-carpet" x={0} y={216} width={TILE_W} height={8} />
                    {Array.from({ length: DOORS_PER_TILE }, (_, d) => (
                      <Door key={d} x={d * CELL_W} number={`${floor}${String(d + 1).padStart(2, "0")}`} hanger={hasHanger(floor, d)} />
                    ))}
                  </g>
                </defs>
                {Array.from({ length: TILES }, (_, t) => (
                  <use key={t} href={`#${id}`} x={t * TILE_W} />
                ))}
              </svg>
            </div>
          );
        })}
      </div>
    </div>
  );
}
