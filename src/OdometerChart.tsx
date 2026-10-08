import { useState, type PointerEvent } from "react";
import type { Analysis } from "./model";

const number = new Intl.NumberFormat("de-DE");
const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  timeZone: "UTC",
});

/** Scrub or select one exported observation; date, departure and meter stay together. */
export function OdometerChart({
  observations,
  selectionScope,
}: {
  observations: Analysis["odometer"];
  selectionScope: string;
}) {
  const [selection, setSelection] = useState<{ scope: string; index: number } | null>(null);
  const [hover, setHover] = useState<{ scope: string; index: number } | null>(null);
  const selected =
    selection?.scope === selectionScope
      ? Math.min(selection.index, observations.length - 1)
      : observations.length - 1;
  const active =
    hover?.scope === selectionScope ? Math.min(hover.index, observations.length - 1) : selected;
  const point = observations[active];
  if (!point) return null;
  const low = Math.min(...observations.map((point) => point.odometerKm));
  const high = Math.max(...observations.map((point) => point.odometerKm));
  const left = 82;
  const width = 630;
  const pointX = (index: number) =>
    left + (observations.length > 1 ? index / (observations.length - 1) : 0.5) * width;
  const pointY = (value: number) => 160 - (high > low ? (value - low) / (high - low) : 0.5) * 125;
  const yTicks = [
    ...new Set(
      high === low
        ? [low]
        : Array.from({ length: 5 }, (_, index) => Math.round(low + ((high - low) * index) / 4)),
    ),
  ];
  const tickIndices = [
    ...new Set(
      Array.from({ length: 5 }, (_, index) => Math.round((index * (observations.length - 1)) / 4)),
    ),
  ];
  const ticks = tickIndices.filter(
    (index, position) =>
      position === 0 || observations[index].date !== observations[tickIndices[position - 1]].date,
  );
  const pointDate = date.format(new Date(`${point.date}T12:00:00Z`));
  const readout = `${pointDate} · ${point.startTime} · ${number.format(point.odometerKm)} km`;
  const indexAt = (event: PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    const matrix = svg.getScreenCTM();
    if (!matrix) return selected;
    const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return Math.max(
      0,
      Math.min(
        observations.length - 1,
        Math.round(((position.x - left) / width) * (observations.length - 1)),
      ),
    );
  };
  return (
    <figure className="odometer-plot">
      <figcaption>
        <h3>Kilometerstand</h3>
        <p>Exportierte Werte in zeitlicher Reihenfolge</p>
      </figcaption>
      <div className="odometer-readout" aria-live="polite">
        <strong>
          {number.format(point.odometerKm)} <span>km</span>
        </strong>
        <span>
          {pointDate} · {point.startTime}
        </span>
      </div>
      <svg
        viewBox="0 0 760 205"
        role="img"
        aria-labelledby="odometer-chart-title odometer-chart-description"
        onPointerMove={(event) => setHover({ scope: selectionScope, index: indexAt(event) })}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(event) => {
          setSelection({ scope: selectionScope, index: indexAt(event) });
          setHover(null);
        }}
      >
        <title id="odometer-chart-title">Kilometerstandsverlauf der ausgewählten Fahrten</title>
        <desc id="odometer-chart-description">
          {observations.length} Beobachtungen, nach Datum und Startzeit geordnet. Aktuell: {readout}
          . Die Punktabstände zeigen keine Zeitdauer. Alle Werte stehen in der Tabelle.
        </desc>
        {yTicks.map((value, index) => (
          <g key={index}>
            <line
              className="odometer-guide"
              x1={left}
              x2={left + width}
              y1={pointY(value)}
              y2={pointY(value)}
            />
            <text className="odometer-y-tick" x={left - 10} y={pointY(value) + 4} textAnchor="end">
              {number.format(value)}
            </text>
          </g>
        ))}
        <polyline
          className="odometer-line"
          points={observations
            .map((point, index) => `${pointX(index)},${pointY(point.odometerKm)}`)
            .join(" ")}
        />
        {observations.map((point, index) => (
          <circle
            key={point.id}
            cx={pointX(index)}
            cy={pointY(point.odometerKm)}
            r="3"
            className="odometer-point"
          />
        ))}
        <line
          className="odometer-crosshair"
          x1={pointX(active)}
          x2={pointX(active)}
          y1="24"
          y2="166"
        />
        <circle
          className="odometer-active"
          cx={pointX(active)}
          cy={pointY(point.odometerKm)}
          r="5"
        />
        {ticks.map((index, position) => (
          <text
            key={index}
            x={pointX(index)}
            y="194"
            textAnchor={position === 0 ? "start" : position === ticks.length - 1 ? "end" : "middle"}
            className={`odometer-tick${position % 2 === 1 && position !== ticks.length - 1 ? " secondary-tick" : ""}`}
          >
            {shortDate.format(new Date(`${observations[index].date}T12:00:00Z`))}
          </text>
        ))}
      </svg>
      <input
        className="odometer-slider"
        type="range"
        aria-label="Fahrt im Kilometerstandsverlauf auswählen"
        aria-valuetext={`${date.format(new Date(`${observations[selected].date}T12:00:00Z`))} ${observations[selected].startTime}: ${number.format(observations[selected].odometerKm)} km`}
        min={0}
        max={observations.length - 1}
        step={1}
        value={selected}
        disabled={observations.length === 1}
        onFocus={() => setHover(null)}
        onChange={(event) => {
          setSelection({ scope: selectionScope, index: Number(event.target.value) });
          setHover(null);
        }}
      />
      <p className="chart-note">
        Über die Grafik fahren oder eine Fahrt mit dem Regler auswählen. Die Punktabstände zeigen
        keine Zeitdauer.
      </p>
    </figure>
  );
}
